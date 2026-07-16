const $ = (id) => document.getElementById(id);
const state = { connectionId: null, platform: null, evidence: null, gmailConnectionId: null, gmailEmail: null };

async function api(path, opts) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  const body = await res.json().catch(() => ({ success: false, error: "bad response" }));
  if (!res.ok || body.success === false) throw new Error(body.error || `HTTP ${res.status}`);
  return body.data;
}

function setStep(done, active) {
  ["s1", "s2", "s3", "s4", "s5"].forEach((s) => $(s).classList.remove("active"));
  done.forEach((s) => { $(s).classList.remove("active"); $(s).classList.add("done"); });
  if (active) $(active).classList.add("active");
}

function addLog(ico, html) {
  const el = document.createElement("div");
  el.className = "entry";
  el.innerHTML = `<span class="ico">${ico}</span><div class="txt">${html}</div>`;
  $("logBody").appendChild(el);
  $("logBody").scrollTop = $("logBody").scrollHeight;
}

function showErr(id, msg) {
  const el = $(id);
  el.textContent = msg;
  el.style.display = "block";
}

// ── STEP 1 · CONNECT ─────────────────────────────────────────────────────────
function startOAuth() {
  const platform = state.platform || "Instagram";
  window.location.href = `/api/connect/oauth/start?platform=${encodeURIComponent(platform)}`;
}

function connectGmail() {
  // Kicks off Google OAuth (gmail.send). Returns to /?gmailConnected=<email>.
  window.location.href = "/api/connect/gmail/start";
}

function toggleSession() {
  const box = $("sessionBox");
  box.style.display = box.style.display === "none" ? "block" : "none";
}

async function saveSession() {
  try {
    const conn = await api("/api/connect/session", {
      method: "POST",
      body: JSON.stringify({
        platform: $("sessPlatform").value.trim() || "Instagram",
        storageState: $("sessState").value.trim(),
      }),
    });
    state.connectionId = conn.id;
    state.platform = conn.platform;
    await refreshConnections();
    $("sessionBox").style.display = "none";
  } catch (e) {
    alert("Could not save session: " + e.message);
  }
}

async function refreshConnections() {
  const tags = [];
  // Platform connections (OAuth / imported session).
  try {
    const list = await api("/api/connect");
    if (list.length) {
      list.forEach((c) => tags.push(`<span class="tag">${c.platform} · ${c.mode}</span>`));
      if (!state.connectionId) { state.connectionId = list[0].id; state.platform = list[0].platform; }
    }
  } catch { /* ignore */ }
  // Gmail sending connection.
  try {
    const gmail = await api("/api/connect/gmail");
    if (gmail.length) {
      state.gmailConnectionId = gmail[0].id;
      state.gmailEmail = gmail[0].email;
      tags.push(`<span class="tag">✉️ ${gmail[0].email ?? "Gmail"} · send</span>`);
    }
  } catch { /* ignore */ }
  $("connList").innerHTML = tags.length ? "Connected: " + tags.join(" ") : "";
}

function gotoCapture() {
  setStep(["s1"], "s2");
  $("phase2").style.display = "block";
  if (state.platform) $("postUrl").placeholder = `https://${state.platform.toLowerCase()}.com/p/…`;
  $("phase2").scrollIntoView({ behavior: "smooth", block: "center" });
}

// ── STEP 2 · CAPTURE & SEAL ──────────────────────────────────────────────────
async function doSeal() {
  const url = $("postUrl").value.trim();
  $("sealErr").style.display = "none";
  if (!url) return showErr("sealErr", "Paste the link to the post first.");
  $("urlBar").textContent = url + " · your session";
  $("sealBtn").disabled = true;
  $("sealBtn").textContent = "Sealing…";
  $("log").style.display = "block";
  $("logTitle").textContent = "Sealing evidence…";
  $("logBody").innerHTML = "";
  $("pulse").className = "pulse";
  addLog("📸", "Opening the page <em>in your session</em> and capturing DOM + full-page screenshot.");

  try {
    const meta = await api("/api/capture", {
      method: "POST",
      body: JSON.stringify({ url, platform: state.platform, connectionId: state.connectionId }),
    });
    state.evidence = meta;
    addLog("🔑", `Hashed at capture — HTML <span class="tool">SHA-256 ${meta.htmlSha256.slice(0, 10)}…</span>`);
    addLog("🔑", `Screenshot <span class="tool">SHA-256 ${meta.screenshotSha256.slice(0, 10)}…</span>`);
    addLog("✓", `Signed &amp; sealed via <span class="tool">${meta.attestation.authority}</span>.`);
    addLog("🗄️", "Stored in your Vault (AES-256-GCM encrypted). Metadata only shown below.");
    $("pulse").className = "pulse done";
    $("logTitle").textContent = "Evidence sealed";
    renderSeal(meta);
    setStep(["s1", "s2"], "s3");
    $("attachRef").textContent = meta.evidenceId.slice(0, 18) + "…";
    $("phase3").style.display = "block";
    $("phase3").scrollIntoView({ behavior: "smooth", block: "center" });
  } catch (e) {
    $("pulse").className = "pulse done";
    $("logTitle").textContent = "Capture failed";
    showErr("sealErr", "Capture failed: " + e.message);
    $("sealBtn").disabled = false;
    $("sealBtn").textContent = "Seal this page as evidence →";
  }
}

function renderSeal(m) {
  const r = $("results");
  r.style.display = "block";
  r.innerHTML = `<div class="block-title">Sealed evidence — tamper-evident</div>
    <div class="seal-card">
      <div class="seal-h">🛡️ Evidence sealed <span class="pill ok">signed</span></div>
      <div class="kv"><span class="k">Evidence ID</span><span class="v">${m.evidenceId}</span></div>
      <div class="kv"><span class="k">Platform</span><span class="v">${m.platform}</span></div>
      <div class="kv"><span class="k">HTML SHA-256</span><span class="v">${m.htmlSha256}</span></div>
      <div class="kv"><span class="k">Screenshot SHA-256</span><span class="v">${m.screenshotSha256}</span></div>
      <div class="kv"><span class="k">Sealed at</span><span class="v">${m.sealedAt}</span></div>
      <div class="kv"><span class="k">Authority</span><span class="v">${m.attestation.authority}</span></div>
      <div class="kv"><span class="k">Content</span><span class="v">encrypted · never displayed</span></div>
    </div>`;
}

// ── STEP 3+4 · RUN (live SSE) ────────────────────────────────────────────────
function doRun() {
  const description = $("desc").value.trim();
  $("runErr").style.display = "none";
  if (!state.evidence) return showErr("runErr", "Seal evidence first.");
  if (!description) return showErr("runErr", "Tell Lea what happened.");
  $("actBtn").disabled = true;
  $("actBtn").textContent = "Working…";
  setStep(["s1", "s2", "s3"], "s4");
  $("logTitle").textContent = "Lea is taking action…";
  $("pulse").className = "pulse";
  // reset log for the action phase but keep it visible
  $("logBody").innerHTML = "";

  const qs = new URLSearchParams({ evidenceId: state.evidence.evidenceId, description });
  if (state.gmailConnectionId) qs.set("gmailConnectionId", state.gmailConnectionId);
  const es = new EventSource(`/api/run?${qs}`);

  es.addEventListener("log", (ev) => {
    const e = JSON.parse(ev.data);
    addLog(e.icon, e.message.replace(/`([^`]+)`/g, '<span class="tool">$1</span>'));
  });
  es.addEventListener("result", (ev) => {
    const result = JSON.parse(ev.data);
    $("pulse").className = "pulse done";
    $("logTitle").textContent = "Lea has completed all actions";
    setStep(["s1", "s2", "s3", "s4"], "s5");
    renderCase(result);
    $("foot").style.display = "block";
    $("results").scrollIntoView({ behavior: "smooth", block: "start" });
    es.close();
  });
  es.addEventListener("error", (ev) => {
    let msg = "The run failed.";
    try { msg = JSON.parse(ev.data).message; } catch { /* connection error */ }
    $("pulse").className = "pulse done";
    $("logTitle").textContent = "Action failed";
    showErr("runErr", msg);
    $("actBtn").disabled = false;
    $("actBtn").textContent = "Lea, take action →";
    es.close();
  });
}

function esc(s) {
  return String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
}

function renderCase(result) {
  const c = result.classification;
  const f = result.filing;
  const filedOk = f.delivered;
  const deadline = c.removal_deadline_hours > 0 ? `${c.removal_deadline_hours}h` : "per policy";
  const extra = document.createElement("div");
  extra.innerHTML = `
    <div class="divider"></div>
    <div class="block-title">Harm classification</div>
    <div class="verdict">
      <div class="verdict-top">
        <div class="verdict-lbl">Lea's classification</div>
        <div class="verdict-name">${esc(c.category)}</div>
        <div class="verdict-sub">${esc(c.legal_basis)} · severity: ${esc(c.severity)}</div>
      </div>
      <div class="verdict-body">
        <img class="verdict-mascot" src="/icons/lea-lawyer.png" alt="Lea, legal">
        ${esc(c.rationale)}
        <div style="margin-top:10px">${(c.tags || []).map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</div>
      </div>
    </div>

    <div class="block-title">Takedown notice — drafted by Lea</div>
    <div class="notice">${esc(result.notice)}</div>

    <div class="block-title">Filing &amp; monitoring</div>
    <div class="filing">
      <div><span class="p">${esc(result.platform)}</span>
        <span class="status ${filedOk ? "sent" : "over"}">${filedOk ? "Filed ✓" : "Prepared ⏳"}</span></div>
      <span class="s">${esc(f.confirmation)} · ${filedOk ? `due in ${deadline}` : esc(f.channel)}</span>
    </div>
    <div class="muted" style="margin-bottom:10px">${esc(f.note)}${f.reportUrl ? ` · <a href="${esc(f.reportUrl)}" target="_blank" rel="noopener">report portal ↗</a>` : ""}</div>

    <div class="block-title">Case summary</div>
    <div class="summary">
      <div class="grid">
        <div class="m"><div class="n" style="color:var(--teal-600)">1</div><div class="l">Evidence sealed</div></div>
        <div class="m"><div class="n" style="color:var(--pink-600)">${filedOk ? 1 : 0}</div><div class="l">Notice filed</div></div>
        <div class="m"><div class="n" style="color:var(--gray-600)">${deadline}</div><div class="l">Removal deadline</div></div>
        <div class="m"><div class="n" style="color:var(--teal-600)">${esc((result.matchConfidence || "high").toUpperCase())}</div><div class="l">Match confidence</div></div>
      </div>
      <div class="ref"><span>Case reference</span><span class="num">${esc(result.ref)}</span></div>
      <div style="padding:0 1.25rem 1.25rem;font-size:13px;color:var(--text-muted)">Everything — sealed evidence, the drafted notice, and the filing — is linked under one case in your Vault. Lea can generate an attorney package or IC3 summary on request. You never had to look at the content.</div>
    </div>`;
  $("results").appendChild(extra);
}

// ── boot ─────────────────────────────────────────────────────────────────────
(async function boot() {
  await refreshConnections();

  const params = new URLSearchParams(location.search);

  const connected = params.get("connected");
  const gmailConnected = params.get("gmailConnected");

  if (connected || gmailConnected) {
    const name = connected ?? `Gmail (${gmailConnected})`;

    state.platform = connected ?? "Gmail";

    const banner = document.createElement("div");
    banner.style.cssText =
      "margin-top:10px;font-size:13px;color:var(--teal-700);" +
      "border:1.5px solid var(--teal-100);border-radius:12px;" +
      "padding:10px 12px;background:var(--teal-50);";

    banner.innerHTML = `✓ Authorized <strong>${name}</strong>`;

    $("connList").after(banner);

    history.replaceState({}, "", location.pathname);
  }
})();
