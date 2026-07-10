import { generateJson, SchemaType } from "../../ai/gemini.js";
import type { Schema } from "@google/generative-ai";

export interface Classification {
  category: string;
  category_code: string;
  severity: "low" | "moderate" | "high" | "critical";
  legal_basis: string;
  removal_deadline_hours: number;
  tags: string[];
  rationale: string;
  /** How confident the harm classification is, given the description. */
  classification_confidence: "low" | "medium" | "high";
}

const SCHEMA: Schema = {
  type: SchemaType.OBJECT,
  properties: {
    category: {
      type: SchemaType.STRING,
      description: "Human-readable harm category, e.g. 'Non-Consensual Intimate Image Distribution (NCII)'.",
    },
    category_code: {
      type: SchemaType.STRING,
      description: "Short stable code: NCII, CSAM, DOXX, THREAT, IMPERSONATION, DEFAMATION, TARGETED_HARASSMENT, HATE, COPYRIGHT, OTHER.",
    },
    severity: { type: SchemaType.STRING, format: "enum", enum: ["low", "moderate", "high", "critical"] },
    legal_basis: {
      type: SchemaType.STRING,
      description: "Most relevant legal hook, e.g. 'TAKE IT DOWN Act · 15 U.S.C. § 6851' or 'Platform Community Standards — Bullying & Harassment'.",
    },
    removal_deadline_hours: {
      type: SchemaType.NUMBER,
      description: "Statutory/policy removal window in hours (e.g. 48 for TAKE IT DOWN Act NCII; 0 if none).",
    },
    tags: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
    rationale: {
      type: SchemaType.STRING,
      description: "1-2 sentences explaining the classification. Do NOT restate graphic content.",
    },
    classification_confidence: { type: SchemaType.STRING, format: "enum", enum: ["low", "medium", "high"] },
  },
  required: [
    "category",
    "category_code",
    "severity",
    "legal_basis",
    "removal_deadline_hours",
    "tags",
    "rationale",
    "classification_confidence",
  ],
};

const SYSTEM = `You are Lea's harm-classification brain. You help survivors of online
abuse by classifying what kind of harm a piece of content represents so the right
takedown pathway can be chosen. You are trauma-informed, precise, and legally literate
about US online-harms law (TAKE IT DOWN Act for NCII, 47 U.S.C. § 223, state
cyber-harassment and doxxing statutes, DMCA, and major platform Community Standards).

Rules:
- Classify from the survivor's short description plus platform context.
- Never ask the survivor to re-describe or re-view graphic content.
- Pick the single most actionable category. Prefer the strongest applicable legal basis.
- For non-consensual intimate imagery use category_code NCII and the TAKE IT DOWN Act
  (15 U.S.C. § 6851, 48-hour removal window).
- If the content depicts a minor, use CSAM, severity critical, and note NCMEC/law-enforcement
  escalation in the rationale.
- Be conservative with confidence: only "high" when the description is unambiguous.
- Output strictly matches the provided JSON schema.`;

/** Step 5: classify the harm from the survivor's description + platform. */
export async function classifyHarm(input: {
  description: string;
  platform: string;
}): Promise<Classification> {
  const prompt = `Platform: ${input.platform}
Survivor's description of what happened:
"""
${input.description}
"""
Classify the harm.`;
  return generateJson<Classification>({ system: SYSTEM, prompt, schema: SCHEMA });
}
