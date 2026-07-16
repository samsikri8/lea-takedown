import nodemailer from "nodemailer";
import { config } from "../../config.js";
import { filingRef } from "../../util/ids.js";
import { channelFor } from "./platforms.js";
import { sendWithGmail } from "./gmail-send.js";
import type { Classification } from "../classify/classify.service.js";
import type { EvidenceMeta } from "../capture/capture.service.js";

export interface FilingRecord {
  confirmation: string;
  platform: string;
  channel: "email" | "form-only" | "dry-run";
  sentTo?: string;
  reportUrl: string;
  deadlineHours: number;
  filedAt: string;
  delivered: boolean;
  note: string;
}

let transporter: nodemailer.Transporter | null = null;
function getTransport(): nodemailer.Transporter {
  transporter ??= nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.port === 465, // 465 = implicit TLS; 587 = STARTTLS (Gmail)
    auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
  });
  return transporter;
}

/** Check the SMTP credentials actually connect+auth, without sending mail. */
export async function verifySmtp(): Promise<{ ok: boolean; message: string }> {
  if (!config.smtp.host || !config.smtp.user) {
    return { ok: false, message: "SMTP not configured (set SMTP_HOST, SMTP_USER, SMTP_PASS)." };
  }
  try {
    await getTransport().verify();
    return { ok: true, message: `SMTP ready — ${config.smtp.user} via ${config.smtp.host}.` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Step 6: actually file the takedown. Emails the drafted notice to the platform's
 * designated legal/abuse contact when one exists and SMTP is configured; otherwise
 * records a form-only or dry-run filing so the survivor can submit via the portal.
 */
export async function fileTakedown(input: {
  platform: string;
  classification: Classification;
  evidence: EvidenceMeta;
  notice: string;
  gmailConnectionId?: string;
}): Promise<FilingRecord> {
  const channel = channelFor(input.platform);
  const confirmation = filingRef();
  const filedAt = new Date().toISOString();
  const deadlineHours = input.classification.removal_deadline_hours;

  const base: Omit<FilingRecord, "channel" | "delivered" | "note"> = {
    confirmation,
    platform: input.platform,
    sentTo: channel.legalEmail,
    reportUrl: channel.reportUrl,
    deadlineHours,
    filedAt,
  };

  // No legal email known for this platform → form-only filing.
  if (!channel.legalEmail) {
    return {
      ...base,
      channel: "form-only",
      delivered: false,
      note: `No designated legal email for ${input.platform}. Notice is drafted and sealed; submit via the platform report form: ${channel.reportUrl}`,
    };
  }

  // Build the message and send through connected Gmail or SMTP fallback.
  const subject =
    `Takedown demand — ${input.classification.category_code} — ` +
    `${input.platform} — ${confirmation}`;

  const messageBody = `${input.notice}

— — —
Filing reference: ${confirmation}
Sealed evidence (tamper-evident):
  HTML SHA-256:       ${input.evidence.htmlSha256}
  Screenshot SHA-256: ${input.evidence.screenshotSha256}
  Sealed & signed at: ${input.evidence.sealedAt}
  Authority:          ${input.evidence.attestation.authority}
Content location:     ${input.evidence.sourceUrl}
`;

  if (input.gmailConnectionId) {
    await sendWithGmail(
      input.gmailConnectionId,
      channel.legalEmail,
      subject,
      messageBody,
    );
  } else {
    // No connected Gmail and SMTP is unavailable.
    if (config.smtp.dryRun) {
      return {
        ...base,
        channel: "dry-run",
        delivered: false,
        note:
          `No Gmail account connected and SMTP is not configured. ` +
          `The filing was recorded without sending to ${channel.legalEmail}.`,
      };
    }

    await getTransport().sendMail({
      from: config.smtp.from,
      to: channel.legalEmail,
      bcc: config.smtp.bcc || undefined,
      subject,
      text: messageBody,
    });
  }
    return {
    ...base,
    channel: "email",
    delivered: true,
    note: `Notice emailed to ${channel.legalEmail}. Removal deadline: ${
      deadlineHours > 0 ? `${deadlineHours}h` : "per policy"
    }.`,
  };
}
