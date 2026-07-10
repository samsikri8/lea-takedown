import "dotenv/config";
import { randomBytes, generateKeyPairSync } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");

/**
 * Load a secret from the environment, or lazily generate + persist one to a
 * dotfile for local development so the tool boots with zero config. Production
 * deployments should always set these explicitly in the environment.
 */
function loadOrCreate(envVar: string, file: string, generate: () => string): string {
  const fromEnv = process.env[envVar]?.trim();
  if (fromEnv) return fromEnv;

  const path = resolve(ROOT, file);
  if (existsSync(path)) return readFileSync(path, "utf8").trim();

  const created = generate();
  writeFileSync(path, created, { mode: 0o600 });
  console.warn(
    `[config] ${envVar} not set — generated a dev key at ${file}. ` +
      `Set ${envVar} in the environment for production.`,
  );
  return created;
}

const vaultKeyHex = loadOrCreate("VAULT_KEY", ".vault-key", () =>
  randomBytes(32).toString("hex"),
);

const attestationKeyB64 = loadOrCreate("ATTESTATION_KEY", ".attestation-key", () => {
  const { privateKey } = generateKeyPairSync("ed25519");
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  return Buffer.from(pem).toString("base64");
});

export const config = {
  port: Number(process.env.PORT ?? 8787),
  root: ROOT,

  gemini: {
    apiKey: process.env.GEMINI_API_KEY?.trim() ?? "",
    model: process.env.GEMINI_MODEL?.trim() || "gemini-2.0-flash",
  },

  vault: {
    /** 32-byte AES-256-GCM key for encrypting sealed content at rest. */
    key: Buffer.from(vaultKeyHex, "hex"),
    /** Ed25519 PKCS8 PEM used to sign seal attestations. */
    attestationPem: Buffer.from(attestationKeyB64, "base64").toString("utf8"),
  },

  smtp: {
    host: process.env.SMTP_HOST?.trim() ?? "",
    port: Number(process.env.SMTP_PORT ?? 587),
    user: process.env.SMTP_USER?.trim() ?? "",
    pass: process.env.SMTP_PASS?.trim() ?? "",
    from: process.env.SMTP_FROM?.trim() || "Lea Takedown <takedowns@localhost>",
    bcc: process.env.FILING_BCC?.trim() ?? "",
    /**
     * Filing is recorded but not actually sent while credentials are incomplete.
     * We treat a host with no user/pass as dry-run too, so you can pre-fill the
     * Gmail host and still stay safe until the app password is added.
     */
    get dryRun() {
      return !this.host || !this.user || !this.pass;
    },
  },

  oauth: {
    metaClientId: process.env.META_CLIENT_ID?.trim() ?? "",
    metaClientSecret: process.env.META_CLIENT_SECRET?.trim() ?? "",
    redirectBase: process.env.OAUTH_REDIRECT_BASE?.trim() || "http://localhost:8787",
    get configured() {
      return Boolean(this.metaClientId && this.metaClientSecret);
    },
  },
};

export function assertGeminiConfigured(): void {
  if (!config.gemini.apiKey) {
    throw new Error(
      "GEMINI_API_KEY is not set. Add it to .env — classification and notice " +
        "drafting need the Gemini API. Get a key at https://aistudio.google.com/apikey",
    );
  }
}
