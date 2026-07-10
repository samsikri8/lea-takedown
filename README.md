# Lea — Evidence → Takedown

A real, working tool that helps someone experiencing online harassment **capture
evidence, seal it tamper-evident, classify the harm, draft a legal notice, file
it, and store the whole case** — without ever having to look at the content again.

This is not a mock. Every step runs real code:

| Step | What actually happens |
|------|-----------------------|
| **1 · Connect** | Real OAuth 2.0 authorization-code flow (Meta/Instagram-configurable), or "session import" mode where you paste a Playwright `storageState` so Lea can reach login-gated content. Credentials are AES-256-GCM sealed in the vault. |
| **2 · Capture & seal** | Real **Playwright** (headless Chromium) opens the post in-session, captures the DOM + a full-page screenshot, hashes both with **SHA-256** at capture time, signs a tamper-evident **Ed25519** attestation over the hashes + timestamp, and encrypts the content into the vault. Metadata only ever leaves the vault. |
| **3 · Describe** | One sentence from the survivor, stored with the case. |
| **4 · Classify** | Real **Gemini** call → structured harm classification (category, legal basis, severity, removal deadline, confidence). |
| **5 · Draft + file** | Gemini drafts a platform-ready legal notice citing the sealed hashes; it is then **actually emailed** (SMTP) to the platform's designated legal/abuse contact, or recorded as a form-only/dry-run filing with the real report-portal URL. |
| **6 · Store** | Everything lands under one case reference in an encrypted **SQLite** vault. |

## Why filing is email, not an API

No major platform exposes a third-party "delete this post" API. The real,
legally-recognized takedown channel is a **formal notice to the platform's
designated agent** (DMCA / NCII / abuse contact) plus the platform's report
portal. This tool uses that real channel — it does not pretend a delete-API
exists. See `src/features/takedown/platforms.ts` for the contact registry
(verify each against the platform's current terms before production use).

## Run it

```bash
cd lea-takedown
npm install            # also downloads Playwright's Chromium
cp .env.example .env   # then add your GEMINI_API_KEY
npm run dev            # http://localhost:8787
```

Only `GEMINI_API_KEY` is required for the classify/draft/file steps. Capture,
sealing and storage work with zero config (dev keys are auto-generated to
`.vault-key` / `.attestation-key` on first boot).

### Configuration (`.env`)

- `GEMINI_API_KEY` — required. Get one at <https://aistudio.google.com/apikey>.
- `SMTP_*` — set to actually email notices. Left blank → filing runs in **dry-run**
  (notice fully drafted and sealed, nothing sent).
- `META_CLIENT_ID` / `META_CLIENT_SECRET` — set to enable real OAuth. Left blank →
  **session-import** mode for logged-in capture.
- `VAULT_KEY` / `ATTESTATION_KEY` — set explicitly in production; auto-generated in dev.

## API

| Method | Path | Purpose |
|--------|------|---------|
| `GET`  | `/api/health` | Config surface (which capabilities are live). |
| `GET`  | `/api/connect` | List sealed connections. |
| `GET`  | `/api/connect/oauth/start?platform=` | Begin OAuth. |
| `GET`  | `/api/connect/oauth/callback` | OAuth redirect target. |
| `POST` | `/api/connect/session` | Import a `storageState` session. |
| `POST` | `/api/capture` | Capture + seal a URL → evidence metadata. |
| `GET`  | `/api/evidence/:id` | Fetch sealed evidence metadata. |
| `POST` | `/api/classify` | Standalone harm classification. |
| `GET`  | `/api/run?evidenceId=&description=` | **SSE** stream of the full agentic takedown. |
| `GET`  | `/api/cases` / `/api/cases/:ref` | The vault. |

## Architecture

```
src/
  config.ts                     env + auto-generated dev keys
  ai/gemini.ts                  Gemini client (JSON + text)
  db/index.ts                   SQLite vault schema
  vault/crypto.ts               SHA-256, AES-256-GCM seal/unseal, Ed25519 attest
  features/
    auth/connect.service.ts     step 1 — OAuth + session import
    capture/capture.service.ts  steps 2-3 — Playwright capture, hash, seal, store
    classify/classify.service.ts step 4 — Gemini harm classification
    takedown/
      notice.ts                 Gemini notice drafting
      platforms.ts              real per-platform reporting channels
      file.ts                   step 5 — email/form/dry-run filing
      takedown.service.ts       orchestration + case persistence
  server.ts                     Hono app + SSE + static frontend
public/                         the frontend (index.html + app.js)
```

## Safety notes

- Harassment content is **never** stored in plaintext and never shown back to the
  survivor — only hashes and metadata surface.
- Auto-filing rides on a high match-confidence gate enforced in code, so notices
  aren't filed against the wrong content.
- This tool assists a survivor acting on their own behalf. It is not legal advice;
  the drafted notice should be reviewed for the specific jurisdiction and platform.
```
