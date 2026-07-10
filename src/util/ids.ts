import { randomUUID, randomBytes } from "node:crypto";

export const uuid = randomUUID;

/** Human-facing case reference, e.g. LEA-7K2QX9. Unambiguous alphabet. */
export function caseRef(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(6);
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return `LEA-${out}`;
}

/** Short filing confirmation id, e.g. TD-9F2A7C. */
export function filingRef(): string {
  return `TD-${randomBytes(3).toString("hex").toUpperCase()}`;
}
