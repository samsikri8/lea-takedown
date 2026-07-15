import { google } from "googleapis";
import { config } from "../../config.js";
import { randomBytes } from "node:crypto";
import { db, nowIso } from "../../db/index.js";
import { uuid } from "../../util/ids.js";
import { seal, unseal } from "../../vault/crypto.js";

const pendingStates = new Map<string, number>();
const STATE_TTL_MS = 10 * 60 * 1000;

function createOAuthClient() {
  if (!config.google.configured) {
    throw new Error("Google OAuth is not configured");
  }

  return new google.auth.OAuth2(
    config.google.clientId,
    config.google.clientSecret,
    config.google.redirectUri,
  );
}

export function getGoogleAuthUrl() {
  const oauth = createOAuthClient();

  const state = randomBytes(24).toString("hex");
  pendingStates.set(state, Date.now());

  const url = oauth.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [
      "https://www.googleapis.com/auth/gmail.send",
      "https://www.googleapis.com/auth/userinfo.email",
    ],
    state,
  });

  return { url, state };
}

export async function handleGoogleCallback(code: string, state: string) {
  const createdAt = pendingStates.get(state);
  pendingStates.delete(state);

  if (!createdAt || Date.now() - createdAt > STATE_TTL_MS) {
    throw new Error("Invalid or expired Google OAuth state");
  }

  const oauth = createOAuthClient();
  const { tokens } = await oauth.getToken(code);
  oauth.setCredentials(tokens);

  const oauth2 = google.oauth2({
    version: "v2",
    auth: oauth,
  });

  const profile = await oauth2.userinfo.get();
  const email = profile.data.email ?? null;

  const id = uuid();
  const now = nowIso();

  db.prepare(
    `INSERT INTO gmail_connections
      (id, email, token_sealed, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(
    id,
    email,
    JSON.stringify(
      seal(Buffer.from(JSON.stringify(tokens), "utf8")),
    ),
    now,
    now,
  );

  return { id, email };
}

export function listGmailConnections() {
  return db
    .prepare(
      `SELECT id, email, created_at
       FROM gmail_connections
       ORDER BY created_at DESC`,
    )
    .all();
}

export function getGmailConnection(connectionId: string) {
  const row = db
    .prepare(
      `SELECT id, email, token_sealed
       FROM gmail_connections
       WHERE id = ?`,
    )
    .get(connectionId) as
    | {
        id: string;
        email: string | null;
        token_sealed: string;
      }
    | undefined;

  if (!row) {
    throw new Error("Gmail connection not found");
  }

  const tokens = JSON.parse(
    unseal(JSON.parse(row.token_sealed)).toString("utf8"),
  );

  return {
    id: row.id,
    email: row.email,
    tokens,
  };
}