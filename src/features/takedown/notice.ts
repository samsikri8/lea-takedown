import { generateText } from "../../ai/gemini.js";
import type { Classification } from "../classify/classify.service.js";
import type { EvidenceMeta } from "../capture/capture.service.js";

const SYSTEM = `You are Lea's legal-notice drafter. You write formal, platform-ready
takedown notices on behalf of a survivor of online abuse. Notices must be firm,
factual, and legally grounded, and must cite the tamper-evident evidence Lea sealed.

Rules:
- Do NOT describe or restate graphic content. Refer to it by category and location only.
- Cite the correct legal basis for the classification (e.g. TAKE IT DOWN Act, 15 U.S.C.
  § 6851 and its 48-hour removal requirement for NCII; DMCA 17 U.S.C. § 512 for copyright).
- Reference the sealed evidence: the SHA-256 hashes and the signed timestamp, and state
  the evidence is preserved and available to the platform and law enforcement on request.
- Include a clear removal demand with the applicable deadline.
- Keep it under ~250 words. Professional letter form. No placeholders in brackets other
  than [Survivor name] and [Contact email], which the caller will fill.`;

/** Step 5 (draft): Gemini writes the platform-ready takedown notice. */
export async function draftNotice(input: {
  classification: Classification;
  evidence: EvidenceMeta;
  description: string;
}): Promise<string> {
  const { classification: c, evidence: e } = input;
  const prompt = `Draft a takedown notice.

Platform: ${e.platform}
Content location (URL): ${e.sourceUrl}
Harm category: ${c.category} (${c.category_code})
Legal basis: ${c.legal_basis}
Removal deadline: ${c.removal_deadline_hours > 0 ? `${c.removal_deadline_hours} hours` : "per platform policy"}
Survivor's account (do not quote graphic detail): "${input.description}"

Sealed, tamper-evident evidence:
- HTML SHA-256: ${e.htmlSha256}
- Screenshot SHA-256: ${e.screenshotSha256}
- Sealed & signed at: ${e.sealedAt}
- Attestation authority: ${e.attestation.authority}

Write the notice now.`;
  return generateText({ system: SYSTEM, prompt });
}
