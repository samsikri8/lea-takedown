import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import type { Schema } from "@google/generative-ai";
import { assertGeminiConfigured, config } from "../config.js";

let client: GoogleGenerativeAI | null = null;
function getClient(): GoogleGenerativeAI {
  assertGeminiConfigured();
  client ??= new GoogleGenerativeAI(config.gemini.apiKey);
  return client;
}

/**
 * Call Gemini and get back JSON matching `schema`. Used for harm classification
 * where we need a machine-checkable structured result, not prose.
 */
export async function generateJson<T>(opts: {
  system: string;
  prompt: string;
  schema: Schema;
}): Promise<T> {
  const model = getClient().getGenerativeModel({
    model: config.gemini.model,
    systemInstruction: opts.system,
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: opts.schema,
      temperature: 0.1,
    },
  });
  const res = await model.generateContent(opts.prompt);
  return JSON.parse(res.response.text()) as T;
}

/** Call Gemini for free-form text — used to draft the legal takedown notice. */
export async function generateText(opts: {
  system: string;
  prompt: string;
}): Promise<string> {
  const model = getClient().getGenerativeModel({
    model: config.gemini.model,
    systemInstruction: opts.system,
    generationConfig: { temperature: 0.3 },
  });
  const res = await model.generateContent(opts.prompt);
  return res.response.text().trim();
}

export { SchemaType };
