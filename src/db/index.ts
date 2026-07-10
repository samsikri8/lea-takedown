import Database from "better-sqlite3";
import { resolve } from "node:path";
import { config } from "../config.js";

/**
 * Single SQLite vault. Content columns hold AES-256-GCM ciphertext only —
 * plaintext harassment content is never persisted. This is the "store it" step:
 * evidence, classification, notice and filing all live under one case row.
 */
export const db = new Database(resolve(config.root, "vault.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS connections (
    id            TEXT PRIMARY KEY,
    platform      TEXT NOT NULL,
    display_name  TEXT,
    mode          TEXT NOT NULL,               -- 'oauth' | 'session'
    token_sealed  TEXT,                        -- sealed OAuth token / session
    created_at    TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS evidence (
    id                 TEXT PRIMARY KEY,
    platform           TEXT NOT NULL,
    source_url         TEXT,
    html_sha256        TEXT NOT NULL,
    screenshot_sha256  TEXT NOT NULL,
    html_sealed        TEXT NOT NULL,          -- ciphertext
    screenshot_sealed  TEXT NOT NULL,          -- ciphertext
    attestation        TEXT NOT NULL,          -- JSON signed attestation
    sealed_at          TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS cases (
    id             TEXT PRIMARY KEY,
    ref            TEXT NOT NULL UNIQUE,        -- human ref, e.g. LEA-7K2QX9
    evidence_id    TEXT NOT NULL REFERENCES evidence(id),
    description    TEXT NOT NULL,
    platform       TEXT NOT NULL,
    classification TEXT,                        -- JSON from Gemini
    notice         TEXT,                        -- drafted notice text
    filing         TEXT,                        -- JSON filing record
    status         TEXT NOT NULL,               -- 'open' | 'filed' | 'resolved'
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL
  );
`);

export function nowIso(): string {
  return new Date().toISOString();
}
