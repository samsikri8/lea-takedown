import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createPrivateKey,
  createPublicKey,
  randomBytes,
  sign as edSign,
} from "node:crypto";
import { config } from "../config.js";

/** SHA-256 hex digest of a buffer — the capture-time fingerprint of content. */
export function sha256(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

export interface SealedBlob {
  /** base64 iv + authTag + ciphertext, self-contained for storage. */
  ciphertext: string;
  algorithm: "aes-256-gcm";
}

/**
 * Encrypt content for the vault. Never store harassment content in the clear —
 * this is what lets us keep evidence without the survivor (or an attacker who
 * reads the DB) ever seeing it.
 */
export function seal(plaintext: Buffer): SealedBlob {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", config.vault.key, iv);
  const enc = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: Buffer.concat([iv, tag, enc]).toString("base64"),
    algorithm: "aes-256-gcm",
  };
}

/** Decrypt a vault blob. Only ever called for export/law-enforcement handoff. */
export function unseal(blob: SealedBlob): Buffer {
  const raw = Buffer.from(blob.ciphertext, "base64");
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const enc = raw.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", config.vault.key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]);
}

export interface Attestation {
  htmlSha256: string;
  screenshotSha256: string;
  sealedAt: string;
  /** Ed25519 signature over the canonical attestation string. */
  signature: string;
  authority: string;
  publicKeyPem: string;
}

function attestationPayload(htmlSha: string, shotSha: string, sealedAt: string): string {
  // Canonical, order-fixed string so verification is unambiguous.
  return [
    "lea-attestation-v1",
    `html:${htmlSha}`,
    `screenshot:${shotSha}`,
    `sealedAt:${sealedAt}`,
  ].join("\n");
}

/**
 * Produce a tamper-evident attestation: an Ed25519 signature over the content
 * hashes + timestamp. Anyone with the public key can later verify the evidence
 * has not been altered since sealing — no trusted third party required, though
 * an RFC-3161 TSA can be layered on top for external non-repudiation.
 */
export function attest(htmlSha: string, shotSha: string, sealedAt: string): Attestation {
  const privateKey = createPrivateKey(config.vault.attestationPem);
  const payload = attestationPayload(htmlSha, shotSha, sealedAt);
  const signature = edSign(null, Buffer.from(payload), privateKey).toString("base64");
  const publicKeyPem = createPublicKey(privateKey)
    .export({ type: "spki", format: "pem" })
    .toString();
  return {
    htmlSha256: htmlSha,
    screenshotSha256: shotSha,
    sealedAt,
    signature,
    authority: "lea-server-attestation (ed25519)",
    publicKeyPem,
  };
}
