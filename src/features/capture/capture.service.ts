import { chromium } from "playwright";
import type { BrowserContextOptions } from "playwright";
import { db, nowIso } from "../../db/index.js";
import { uuid } from "../../util/ids.js";
import { attest, seal, sha256 } from "../../vault/crypto.js";
import { unseal } from "../../vault/crypto.js";

export interface CaptureInput {
  url: string;
  platform: string;
  /** Optional social connection whose saved session reaches login-gated content. */
  connectionId?: string;
}

export interface EvidenceMeta {
  evidenceId: string;
  platform: string;
  sourceUrl: string;
  htmlSha256: string;
  screenshotSha256: string;
  sealedAt: string;
  attestation: ReturnType<typeof attest>;
}

/** Infer a platform label from the URL host for nicer defaults. */
export function platformFromUrl(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    const known: Record<string, string> = {
      "instagram.com": "Instagram",
      "x.com": "X",
      "twitter.com": "X",
      "facebook.com": "Facebook",
      "tiktok.com": "TikTok",
      "reddit.com": "Reddit",
      "youtube.com": "YouTube",
    };
    return known[host] ?? host;
  } catch {
    return "unknown";
  }
}

/** Pull a saved Playwright storageState from a sealed connection, if present. */
function sessionForConnection(connectionId?: string): BrowserContextOptions["storageState"] | undefined {
  if (!connectionId) return undefined;
  const row = db
    .prepare("SELECT token_sealed, mode FROM connections WHERE id = ?")
    .get(connectionId) as { token_sealed: string | null; mode: string } | undefined;
  if (!row?.token_sealed || row.mode !== "session") return undefined;
  const json = unseal(JSON.parse(row.token_sealed)).toString("utf8");
  return JSON.parse(json) as BrowserContextOptions["storageState"];
}

/**
 * Step 3+4: open the page *in-session*, capture DOM + full-page screenshot,
 * hash them at capture time, sign a tamper-evident attestation, encrypt the
 * content into the vault, and return metadata only. The caller (and survivor)
 * never receives the content itself.
 */
export async function captureAndSeal(input: CaptureInput): Promise<EvidenceMeta> {
  const storageState = sessionForConnection(input.connectionId);
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      storageState,
      viewport: { width: 1280, height: 900 },
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    });
    const page = await context.newPage();
    await page.goto(input.url, { waitUntil: "networkidle", timeout: 45_000 });
    // Let lazy content settle before we freeze the evidence.
    await page.waitForTimeout(1200);

    const html = Buffer.from(await page.content(), "utf8");
    const screenshot = await page.screenshot({ fullPage: true, type: "png" });

    const htmlSha = sha256(html);
    const shotSha = sha256(screenshot);
    const sealedAt = nowIso();
    const attestation = attest(htmlSha, shotSha, sealedAt);

    const evidenceId = uuid();
    db.prepare(
      `INSERT INTO evidence
        (id, platform, source_url, html_sha256, screenshot_sha256,
         html_sealed, screenshot_sealed, attestation, sealed_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    ).run(
      evidenceId,
      input.platform,
      input.url,
      htmlSha,
      shotSha,
      JSON.stringify(seal(html)),
      JSON.stringify(seal(screenshot)),
      JSON.stringify(attestation),
      sealedAt,
    );

    return {
      evidenceId,
      platform: input.platform,
      sourceUrl: input.url,
      htmlSha256: htmlSha,
      screenshotSha256: shotSha,
      sealedAt,
      attestation,
    };
  } finally {
    await browser.close();
  }
}

export function getEvidenceMeta(evidenceId: string): EvidenceMeta | null {
  const row = db
    .prepare(
      `SELECT id, platform, source_url, html_sha256, screenshot_sha256, attestation, sealed_at
       FROM evidence WHERE id = ?`,
    )
    .get(evidenceId) as
    | {
        id: string;
        platform: string;
        source_url: string;
        html_sha256: string;
        screenshot_sha256: string;
        attestation: string;
        sealed_at: string;
      }
    | undefined;
  if (!row) return null;
  return {
    evidenceId: row.id,
    platform: row.platform,
    sourceUrl: row.source_url,
    htmlSha256: row.html_sha256,
    screenshotSha256: row.screenshot_sha256,
    sealedAt: row.sealed_at,
    attestation: JSON.parse(row.attestation),
  };
}
