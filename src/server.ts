import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { config } from "./config.js";
import {
  captureAndSeal,
  getEvidenceMeta,
  platformFromUrl,
} from "./features/capture/capture.service.js";
import { classifyHarm } from "./features/classify/classify.service.js";
import {
  runTakedown,
  getCase,
  listCases,
} from "./features/takedown/takedown.service.js";
import { verifySmtp } from "./features/takedown/file.js";
import {
  startOAuth,
  handleOAuthCallback,
  importSession,
  listConnections,
} from "./features/auth/connect.service.js";
import {
  getGoogleAuthUrl,
  handleGoogleCallback,
  listGmailConnections,
} from "./features/auth/gmail.service.js";
import { sendWithGmail } from "./features/takedown/gmail-send.js";

const app = new Hono();

const err = (e: unknown) => (e instanceof Error ? e.message : String(e));

// ── health / config surface ────────────────────────────────────────────────
app.get("/api/health", (c) =>
  c.json({
    success: true,
    data: {
      ok: true,
      gemini: Boolean(config.gemini.apiKey),
      smtp: config.smtp.dryRun ? "dry-run" : "configured",
      oauth: config.oauth.configured ? "configured" : "session-only",
    },
  }),
);

// ── step 1 · connect social ─────────────────────────────────────────────────
app.get("/api/connect", (c) => c.json({ success: true, data: listConnections() }));

app.get("/api/connect/gmail", (c) =>
  c.json({
    success: true,
    data: listGmailConnections(),
  }),
);

app.get("/api/connect/oauth/start", (c) => {
  const platform = c.req.query("platform") ?? "Instagram";
  try {
    const { authorizeUrl } = startOAuth(platform);
    return c.redirect(authorizeUrl);
  } catch (e) {
    return c.json({ success: false, error: err(e) }, 400);
  }
});

app.get("/api/connect/oauth/callback", async (c) => {
  const code = c.req.query("code");
  const state = c.req.query("state");
  if (!code || !state) return c.json({ success: false, error: "missing code/state" }, 400);
  try {
    const conn = await handleOAuthCallback(code, state);
    return c.redirect(`/?connected=${encodeURIComponent(conn.platform)}`);
  } catch (e) {
    return c.json({ success: false, error: err(e) }, 400);
  }
});

app.get("/api/connect/gmail/start", (c) => {
  try {
    const { url } = getGoogleAuthUrl();
    return c.redirect(url);
  } catch (e) {
    return c.json({ success: false, error: err(e) }, 400);
  }
});

app.get("/api/connect/gmail/callback", async (c) => {
  const code = c.req.query("code");
  const state = c.req.query("state");

  if (!code || !state) {
    return c.json(
      { success: false, error: "missing code/state" },
      400,
    );
  }

  try {
    const connection = await handleGoogleCallback(code, state);

    return c.redirect(
      `/?gmailConnected=${encodeURIComponent(
        connection.email ?? "Gmail",
      )}`,
    );
    } catch (e) {
    console.error("GOOGLE CALLBACK ERROR");
    console.error(e);

    return c.json(
      {
        success: false,
        error: err(e),
      },
      400,
    );
  }
});

app.get("/api/gmail/test", async (c) => {
  try {
    const connections = listGmailConnections();

    if (!connections.length) {
      return c.json({
        success: false,
        error: "No Gmail connection found",
      });
    }

    const connection = connections[0] as {
  id: string;
  email: string | null;
};

if (!connection.email) {
  return c.json({
    success: false,
    error: "Connected Gmail account has no email address",
  });
}

await sendWithGmail(
  connection.id,
  connection.email,
  "Lea Gmail Test",
  "If you received this email, Gmail OAuth is working!",
);

return c.json({
  success: true,
  data: {
    sentTo: connection.email,
  },
});
  } catch (e) {
    return c.json(
      {
        success: false,
        error: e instanceof Error ? e.message : String(e),
      },
      500,
    );
  }
});

const sessionSchema = z.object({
  platform: z.string().min(1),
  storageState: z.string().min(2),
});
app.post("/api/connect/session", async (c) => {
  const parsed = sessionSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ success: false, error: parsed.error.message }, 422);
  try {
    const conn = importSession(parsed.data.platform, parsed.data.storageState);
    return c.json({ success: true, data: conn });
  } catch (e) {
    return c.json({ success: false, error: err(e) }, 400);
  }
});

// ── step 3+4 · capture & seal ───────────────────────────────────────────────
const captureSchema = z.object({
  url: z.string().url(),
  platform: z.string().nullish(),
  connectionId: z.string().nullish(),
});
app.post("/api/capture", async (c) => {
  const parsed = captureSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ success: false, error: parsed.error.message }, 422);
  try {
    const meta = await captureAndSeal({
      url: parsed.data.url,
      platform: parsed.data.platform || platformFromUrl(parsed.data.url),
      connectionId: parsed.data.connectionId ?? undefined,
    });
    return c.json({ success: true, data: meta });
  } catch (e) {
    return c.json({ success: false, error: err(e) }, 500);
  }
});



// ── step 5 · classify (standalone) ──────────────────────────────────────────
const classifySchema = z.object({ description: z.string().min(1), platform: z.string().min(1) });
app.post("/api/classify", async (c) => {
  const parsed = classifySchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ success: false, error: parsed.error.message }, 422);
  try {
    const result = await classifyHarm(parsed.data);
    return c.json({ success: true, data: result });
  } catch (e) {
    return c.json({ success: false, error: err(e) }, 500);
  }
});

// ── step 5+6 · run the full takedown (SSE live log) ─────────────────────────
app.get("/api/run", (c) => {
  const evidenceId = c.req.query("evidenceId") ?? "";
  const description = c.req.query("description") ?? "";
  const gmailConnectionId = c.req.query("gmailConnectionId") || undefined;
  return streamSSE(c, async (stream) => {
    const send = (event: string, data: unknown) =>
      stream.writeSSE({ event, data: JSON.stringify(data) });
    try {
      const result = await runTakedown(
  { evidenceId, description, gmailConnectionId },
  (e) => {
        void send("log", e);
      });
      await send("result", result);
    } catch (e) {
      await send("error", { message: err(e) });
    }
  });
});

// ── filing · verify SMTP creds without sending ──────────────────────────────
app.get("/api/smtp/verify", async (c) => {
  const result = await verifySmtp();
  return c.json({ success: true, data: result });
});

// ── step 7 · vault / cases ──────────────────────────────────────────────────
app.get("/api/cases", (c) => c.json({ success: true, data: listCases() }));
app.get("/api/cases/:ref", (c) => {
  const found = getCase(c.req.param("ref"));
  return found
    ? c.json({ success: true, data: found })
    : c.json({ success: false, error: "not found" }, 404);
});

// ── static frontend ─────────────────────────────────────────────────────────
app.use("/*", serveStatic({ root: "./public" }));

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`\n  Lea — Evidence → Takedown`);
  console.log(`  ▸ http://localhost:${info.port}`);
  console.log(`  ▸ Gemini:  ${config.gemini.apiKey ? "configured" : "NOT SET (add GEMINI_API_KEY)"}`);
  console.log(`  ▸ Filing:  ${config.smtp.dryRun ? "dry-run (set SMTP_* to send)" : "SMTP configured"}`);
  console.log(`  ▸ OAuth:   ${config.oauth.configured ? "configured" : "session-only"}\n`);
});
