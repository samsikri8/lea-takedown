import { randomBytes } from "node:crypto";
import { config } from "../../config.js";
import { db, nowIso } from "../../db/index.js";
import { uuid } from "../../util/ids.js";
import { seal } from "../../vault/crypto.js";

export interface Connection {
  id: string;
  platform: string;
  displayName: string | null;
  mode: "oauth" | "session";
  createdAt: string;
}

// Short-lived CSRF state store for the OAuth handshake.
const pendingStates = new Map<string, { platform: string; at: number }>();

/**
 * Step 1a — real OAuth 2.0 authorization-code start. Returns the provider's
 * authorize URL. Only usable once META_CLIENT_ID/SECRET are configured.
 */
export function startOAuth(platform: string): { authorizeUrl: string; state: string } {
  if (!config.oauth.configured) {
    throw new Error(
      "OAuth is not configured. Set META_CLIENT_ID/META_CLIENT_SECRET, or use session mode.",
    );
  }
  const state = randomBytes(16).toString("hex");
  pendingStates.set(state, { platform, at: Date.now() });
  const redirectUri = `${config.oauth.redirectBase}/api/connect/oauth/callback`;
  const url = new URL("https://www.facebook.com/v21.0/dialog/oauth");
  url.searchParams.set("client_id", config.oauth.metaClientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  // public_profile is granted by default (no app review). Widen to
  // instagram_basic / pages_show_list once the app is review-approved.
  url.searchParams.set("scope", "public_profile");
  url.searchParams.set("response_type", "code");
  return { authorizeUrl: url.toString(), state };
}

/** Step 1b — exchange the authorization code for a token and seal it. */
export async function handleOAuthCallback(code: string, state: string): Promise<Connection> {
  const pending = pendingStates.get(state);
  if (!pending) throw new Error("Invalid or expired OAuth state");
  pendingStates.delete(state);

  const redirectUri = `${config.oauth.redirectBase}/api/connect/oauth/callback`;
  const tokenUrl = new URL("https://graph.facebook.com/v21.0/oauth/access_token");
  tokenUrl.searchParams.set("client_id", config.oauth.metaClientId);
  tokenUrl.searchParams.set("client_secret", config.oauth.metaClientSecret);
  tokenUrl.searchParams.set("redirect_uri", redirectUri);
  tokenUrl.searchParams.set("code", code);

  const res = await fetch(tokenUrl);
  if (!res.ok) throw new Error(`Token exchange failed: ${res.status} ${await res.text()}`);
  const token = (await res.json()) as { access_token: string };

  return persist({
    platform: pending.platform,
    displayName: `${pending.platform} account`,
    mode: "oauth",
    secret: Buffer.from(JSON.stringify(token), "utf8"),
  });
}

/**
 * Step 1 (alternative) — session mode. The user imports a Playwright
 * `storageState` (exported cookies for their logged-in browser) so Lea can reach
 * login-gated content for capture without holding platform API credentials.
 */
export function importSession(platform: string, storageStateJson: string): Connection {
  // Validate it parses; never log the contents.
  JSON.parse(storageStateJson);
  return persist({
    platform,
    displayName: `${platform} session`,
    mode: "session",
    secret: Buffer.from(storageStateJson, "utf8"),
  });
}

function persist(input: {
  platform: string;
  displayName: string;
  mode: "oauth" | "session";
  secret: Buffer;
}): Connection {
  const id = uuid();
  const createdAt = nowIso();
  db.prepare(
    `INSERT INTO connections (id, platform, display_name, mode, token_sealed, created_at)
     VALUES (?,?,?,?,?,?)`,
  ).run(id, input.platform, input.displayName, input.mode, JSON.stringify(seal(input.secret)), createdAt);
  return { id, platform: input.platform, displayName: input.displayName, mode: input.mode, createdAt };
}

export function listConnections(): Connection[] {
  const rows = db
    .prepare("SELECT id, platform, display_name, mode, created_at FROM connections ORDER BY created_at DESC")
    .all() as Array<{ id: string; platform: string; display_name: string | null; mode: string; created_at: string }>;
  return rows.map((r) => ({
    id: r.id,
    platform: r.platform,
    displayName: r.display_name,
    mode: r.mode as "oauth" | "session",
    createdAt: r.created_at,
  }));
}
