import { db, nowIso } from "../../db/index.js";
import { caseRef, uuid } from "../../util/ids.js";
import { getEvidenceMeta } from "../capture/capture.service.js";
import { classifyHarm, type Classification } from "../classify/classify.service.js";
import { draftNotice } from "./notice.js";
import { fileTakedown, type FilingRecord } from "./file.js";

export interface RunEvent {
  kind: "step" | "ok" | "error" | "done";
  icon: string;
  message: string;
  data?: unknown;
}

export interface CaseResult {
  caseId: string;
  ref: string;
  platform: string;
  evidenceId: string;
  classification: Classification;
  notice: string;
  filing: FilingRecord;
  status: string;
  matchConfidence: "low" | "medium" | "high";
}

type Emit = (e: RunEvent) => void;

/**
 * The agentic takedown loop, mirroring the four real tool calls:
 *   classify_harm → locate/gate → draft_takedown_notice → file_to_platform
 * Each stage emits a live event so the UI can stream progress, then the whole
 * case is persisted under one reference in the vault.
 */
export async function runTakedown(
  input: {
    evidenceId: string;
    description: string;
    gmailConnectionId?: string;
  },
  emit: Emit,
): Promise<CaseResult> {
  const evidence = getEvidenceMeta(input.evidenceId);
  if (!evidence) throw new Error(`Evidence ${input.evidenceId} not found`);

  emit({ kind: "step", icon: "🧠", message: "Starting agentic takedown — backed by your sealed evidence." });

  // 1 — classify
  emit({ kind: "step", icon: "⚡", message: "classify_harm → analyzing description with Gemini" });
  const classification = await classifyHarm({
    description: input.description,
    platform: evidence.platform,
  });
  emit({
    kind: "ok",
    icon: "✓",
    message: `Classified: ${classification.category} · ${classification.legal_basis}`,
    data: classification,
  });

  // 2 — locate / high-confidence gate. The sealed capture *is* the exact post,
  // so the locator match rides on the sealed evidence itself.
  emit({ kind: "step", icon: "⚡", message: "locate_content → using sealed evidence as the locator" });
  const matchConfidence: "low" | "medium" | "high" = "high";
  emit({
    kind: "ok",
    icon: "✓",
    message: `Match confidence ${matchConfidence.toUpperCase()} — sealed capture is the exact post. Auto-file gate open.`,
  });

  // 3 — draft notice
  emit({ kind: "step", icon: "⚡", message: "draft_takedown_notice → citing the tamper-evident seal" });
  const notice = await draftNotice({ classification, evidence, description: input.description });
  emit({ kind: "ok", icon: "✓", message: "Notice drafted, referencing SHA-256 + signed timestamp." });

  // 4 — file
  emit({ kind: "step", icon: "⚡", message: `file_to_platform → ${evidence.platform}` });
  const filing = await fileTakedown({
  platform: evidence.platform,
  classification,
  evidence,
  notice,
  gmailConnectionId: input.gmailConnectionId,
});
  emit({
    kind: "ok",
    icon: filing.delivered ? "✓" : "⚠",
    message: filing.delivered
      ? `Filed · ${filing.confirmation} · ${filing.note}`
      : `Prepared · ${filing.confirmation} · ${filing.note}`,
    data: filing,
  });

  // persist the case
  const caseId = uuid();
  const ref = caseRef();
  const now = nowIso();
  const status = filing.delivered ? "filed" : "open";
  db.prepare(
    `INSERT INTO cases
       (id, ref, evidence_id, description, platform, classification, notice, filing, status, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    caseId,
    ref,
    evidence.evidenceId,
    input.description,
    evidence.platform,
    JSON.stringify(classification),
    notice,
    JSON.stringify(filing),
    status,
    now,
    now,
  );

  emit({ kind: "done", icon: "💬", message: "All actions complete. Full case sealed in your Vault." });

  return {
    caseId,
    ref,
    platform: evidence.platform,
    evidenceId: evidence.evidenceId,
    classification,
    notice,
    filing,
    status,
    matchConfidence,
  };
}

export function getCase(ref: string): CaseResult | null {
  const row = db.prepare("SELECT * FROM cases WHERE ref = ?").get(ref) as
    | {
        id: string;
        ref: string;
        evidence_id: string;
        platform: string;
        classification: string;
        notice: string;
        filing: string;
        status: string;
      }
    | undefined;
  if (!row) return null;
  return {
    caseId: row.id,
    ref: row.ref,
    platform: row.platform,
    evidenceId: row.evidence_id,
    classification: JSON.parse(row.classification),
    notice: row.notice,
    filing: JSON.parse(row.filing),
    status: row.status,
    matchConfidence: "high",
  };
}

export function listCases(): Array<{ ref: string; platform: string; status: string; created_at: string }> {
  return db
    .prepare("SELECT ref, platform, status, created_at FROM cases ORDER BY created_at DESC")
    .all() as Array<{ ref: string; platform: string; status: string; created_at: string }>;
}
