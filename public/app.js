/*
 * Builder Log — public/app.js
 * Vanilla JS SPA, no frameworks, no build step, no CDNs.
 * Hash routing: #/checkin  #/history  #/settings  #/onboard
 */

"use strict";

// ── Markdown renderer ──────────────────────────────────────────────────────────
// Handles: # / ## / ###, **bold**, *italic*, `code`, - / * / 1. lists, paragraphs.

function renderMarkdown(text) {
  if (!text) return "";

  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function inline(s) {
    // Escape first, then apply inline markup on the escaped string.
    return esc(s)
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\*([^*]+)\*/g, "<em>$1</em>");
  }

  const lines = text.split("\n");
  const out = [];
  let inUL = false;
  let inOL = false;

  function closeList() {
    if (inUL) { out.push("</ul>"); inUL = false; }
    if (inOL) { out.push("</ol>"); inOL = false; }
  }

  for (const raw of lines) {
    const line = raw;

    const h3 = line.match(/^### (.+)/);
    if (h3) { closeList(); out.push(`<h3>${inline(h3[1])}</h3>`); continue; }

    const h2 = line.match(/^## (.+)/);
    if (h2) { closeList(); out.push(`<h2>${inline(h2[1])}</h2>`); continue; }

    const h1 = line.match(/^# (.+)/);
    if (h1) { closeList(); out.push(`<h1>${inline(h1[1])}</h1>`); continue; }

    const ol = line.match(/^\d+\. (.+)/);
    if (ol) {
      if (!inOL) { closeList(); out.push("<ol>"); inOL = true; }
      out.push(`<li>${inline(ol[1])}</li>`);
      continue;
    }

    const ul = line.match(/^[-*] (.+)/);
    if (ul) {
      if (!inUL) { closeList(); out.push("<ul>"); inUL = true; }
      out.push(`<li>${inline(ul[1])}</li>`);
      continue;
    }

    if (line.trim() === "") {
      closeList();
      out.push("<p></p>");
      continue;
    }

    closeList();
    out.push(`<p>${inline(line)}</p>`);
  }

  closeList();
  return out.join("\n");
}

// ── HTML escape (for non-markdown text) ───────────────────────────────────────

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── API helper ─────────────────────────────────────────────────────────────────

async function api(method, path, body) {
  const opts = { method, headers: {} };
  if (body !== undefined) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(path, opts);
  const data = await res.json();
  if (!res.ok) {
    const err = new Error(data.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

// ── Shared UI helpers ──────────────────────────────────────────────────────────

function el(tag, cls, html) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (html != null) node.innerHTML = html;
  return node;
}

function spinner(msg = "Working…") {
  const wrap = el("div", "spinner-wrap");
  wrap.appendChild(el("div", "spinner"));
  wrap.appendChild(el("span", null, esc(msg)));
  return wrap;
}

function errorBox(msg) {
  return el("div", "error-box", esc(msg));
}

function infoBox(msg) {
  return el("div", "info-box", esc(msg));
}

function successBox(msg) {
  return el("div", "success-box", esc(msg));
}

// ── Router ─────────────────────────────────────────────────────────────────────

const routes = {};

function register(hash, fn) {
  routes[hash] = fn;
}

function navigate(hash) {
  window.location.hash = hash;
}

function handleRoute() {
  const hash = window.location.hash || "#/checkin";
  const fn = routes[hash] || routes["#/checkin"];
  if (!fn) return;
  updateNavActive(hash);
  const main = document.getElementById("main");
  main.innerHTML = "";
  fn(main);
}

function updateNavActive(hash) {
  document.querySelectorAll("[data-route]").forEach((a) => {
    a.classList.toggle("active", a.getAttribute("data-route") === hash);
  });
}

window.addEventListener("hashchange", handleRoute);

// ── App-level state ────────────────────────────────────────────────────────────

let appConfig = null;

// ── Nav ────────────────────────────────────────────────────────────────────────

// Builders Club mark — gear badge with a "B" (from the brand favicon).
const BRAND_LOGO_SVG =
  '<svg class="nav-logo" width="30" height="30" viewBox="-50 -50 100 100" role="img" aria-label="Builders Club">' +
  '<path d="M40.00,0.00L47.70,5.35L46.65,11.29L37.59,13.68L30.64,25.71L33.10,34.76L28.48,38.63L20.00,34.64L6.95,39.39L3.01,47.91L-3.01,47.91L-6.95,39.39L-20.00,34.64L-28.48,38.63L-33.10,34.76L-30.64,25.71L-37.59,13.68L-46.65,11.29L-47.70,5.35L-40.00,0.00L-37.59,-13.68L-42.99,-21.34L-39.98,-26.56L-30.64,-25.71L-20.00,-34.64L-19.22,-43.99L-13.55,-46.05L-6.95,-39.39L6.95,-39.39L13.55,-46.05L19.22,-43.99L20.00,-34.64L30.64,-25.71L39.98,-26.56L42.99,-21.34L37.59,-13.68Z" ' +
  'fill="#4886f3" stroke="#181a1f" stroke-width="2.5" stroke-linejoin="round"/>' +
  '<text x="0" y="1" text-anchor="middle" dominant-baseline="central" font-family="\'Archivo Black\',\'Arial Black\',sans-serif" font-weight="900" font-size="46" fill="#ffffff">B</text>' +
  "</svg>";

// Two-overlapping-squares copy icon (matches the common "copy" affordance).
const COPY_ICON_SVG =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
  'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<rect x="9" y="9" width="13" height="13" rx="2"/>' +
  '<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';

function buildNav(setupComplete) {
  const nav = document.getElementById("nav");
  nav.innerHTML = "";

  // Brand: logo + wordmark, links home to the first available screen.
  const brand = el("a", "nav-brand");
  brand.href = setupComplete ? "#/checkin" : "#/settings";
  brand.innerHTML = BRAND_LOGO_SVG + '<span class="nav-wordmark">Builder Log</span>';
  nav.appendChild(brand);

  // Links pushed to the right side of the header.
  const linksWrap = el("div", "nav-links");
  const links = setupComplete
    ? [["#/checkin", "Check-in"], ["#/history", "History"], ["#/settings", "Settings"]]
    : [["#/settings", "Settings"]];

  links.forEach(([hash, label]) => {
    const a = document.createElement("a");
    a.href = hash;
    a.textContent = label;
    a.className = "nav-link";
    a.setAttribute("data-route", hash);
    linksWrap.appendChild(a);
  });
  nav.appendChild(linksWrap);
}

// ─────────────────────────────────────────────────────────────────────────────
// SCREEN 1 — Check-in (#/checkin)
// ─────────────────────────────────────────────────────────────────────────────

function renderCheckin(container) {
  container.innerHTML = "";
  // Two persistent children: the daily check-in (redrawn by draw()) and the
  // "This week" panel (managed independently so a check-in redraw never wipes
  // it mid-interaction).
  const checkinRoot = el("div");
  const weekRoot = el("div");
  container.appendChild(checkinRoot);
  container.appendChild(weekRoot);

  // Local state machine
  const s = {
    phase: "idle",   // idle | asking | questions | generating | done
    date: null,
    askResult: null,
    syncResult: null,
    pendingAnswers: null,  // string[] parallel to questionList
    slackSent: false,      // questions DM'd to the builder's Slack this session
    slackMsg: "",          // persistent status under the Slack button
    slackMsgCls: "",       // status class (success/warn/error)
    manualArmed: false,    // first click of a manual action while awaiting Slack
    manualWarn: "",        // confirm-warning text (auto-clears after 5s)
    manualTimer: null,
    error: null,
  };

  function draw() {
    checkinRoot.innerHTML = "";
    const screen = el("div", "screen checkin-screen");

    screen.appendChild(el("h1", null, "Daily Check-in"));

    if (s.phase === "idle") {
      screen.appendChild(el("p", "screen-desc", "Record what you built, decided, or learned today."));
      if (s.error) screen.appendChild(errorBox(s.error));
      const row = el("div", "generate-row");
      const btn = el("button", "btn-primary", "Start check-in");
      btn.addEventListener("click", onStartCheckin);
      row.appendChild(btn);

      // In a rush? Do the whole check-in over Slack. First click generates the
      // questions and DMs them to you; the button then becomes "Sync with Slack"
      // and stays there until your reply comes back and the entry is generated.
      if (appConfig && appConfig.chatSurface === "slack") {
        const slackBtn = el("button", "btn-secondary", s.slackSent ? "Sync with Slack" : "Check-in via Slack");
        const slackStatus = el("span", "slack-action-status" + (s.slackMsgCls ? " " + s.slackMsgCls : ""),
          s.slackMsg || "");
        slackBtn.addEventListener("click", () => doSlackCheckin(slackBtn, slackStatus));
        row.appendChild(slackBtn);
        row.appendChild(slackStatus);
      }
      screen.appendChild(row);

      if (s.manualWarn) {
        const w = el("div", "confirm-warn");
        w.textContent = s.manualWarn;
        screen.appendChild(w);
      }
    }

    if (s.phase === "asking") {
      screen.appendChild(spinner("Analyzing your recent work — this takes about 15 seconds…"));
    }

    if (s.phase === "questions") {
      const result = s.askResult;

      if (!result || !result.changed) {
        const empty = el("div", "empty-state");
        empty.appendChild(el("p", null, "No file changes since your last check-in."));
        empty.appendChild(el("p", "muted",
          "Not all progress is code — meetings, decisions, getting stuck, and user " +
          "conversations all count. Check in about those, or edit a file and retry."));
        screen.appendChild(empty);
        const row = el("div", "generate-row");
        const reflectBtn = el("button", "btn-primary", "Check in anyway");
        reflectBtn.addEventListener("click", () => doAsk({ allowEmpty: true }));
        row.appendChild(reflectBtn);
        const btn = el("button", "btn-secondary", "Re-scan files");
        btn.addEventListener("click", () => doAsk());
        row.appendChild(btn);
        screen.appendChild(row);
      } else {
        const qs = result.questionList || [];
        screen.appendChild(el("p", "screen-desc",
          result.reflective
            ? `No files changed — reflect on what you did, decided, or got stuck on, then click "Generate entry."`
            : `Answer these questions about your work, then click "Generate entry" to create your log.`));

        if (s.error) screen.appendChild(errorBox(s.error));

        const textareas = [];
        qs.forEach((q, i) => {
          const block = el("div", "question-block");
          const lbl = el("label", "question-label", esc(q));
          lbl.htmlFor = `ans-${i}`;
          block.appendChild(lbl);
          const ta = el("textarea", "answer-input");
          ta.id = `ans-${i}`;
          ta.rows = 3;
          ta.placeholder = "Your answer…";
          block.appendChild(ta);
          textareas.push(ta);
          screen.appendChild(block);
        });

        const row = el("div", "generate-row");
        const genBtn = el("button", "btn-primary", "Generate entry");
        genBtn.addEventListener("click", () => doSync(qs, textareas));
        row.appendChild(genBtn);
        screen.appendChild(row);
      }
    }

    if (s.phase === "generating") {
      // Show submitted answers dimmed while waiting
      const qs = s.askResult?.questionList || [];
      const answers = s.pendingAnswers || [];
      qs.forEach((q, i) => {
        const block = el("div", "question-block answered");
        block.appendChild(el("p", "question-label", esc(q)));
        block.appendChild(el("p", "answer-preview", esc(answers[i] || "")));
        screen.appendChild(block);
      });
      screen.appendChild(spinner("Generating your log entry — this takes 20–30 seconds…"));
    }

    if (s.phase === "done") {
      const r = s.syncResult;

      // Memory summary
      if (r.memory) {
        const { open = 0, resolvedThisRun = 0, blockers = 0 } = r.memory;
        const parts = [];
        if (open) parts.push(`${open} open commitment${open !== 1 ? "s" : ""}`);
        if (resolvedThisRun) parts.push(`${resolvedThisRun} resolved today`);
        if (blockers) parts.push(`${blockers} blocker${blockers !== 1 ? "s" : ""}`);
        const mem = el("div", "memory-summary",
          parts.length ? parts.join(" · ") : "No open commitments or blockers.");
        screen.appendChild(mem);
      }

      // Log entry
      const entryWrap = el("div", "entry-wrap");
      entryWrap.appendChild(el("div", "section-label", "Your log entry"));
      const entryBody = el("div", "markdown-body");
      entryBody.innerHTML = renderMarkdown(r.entry || "");
      entryWrap.appendChild(entryBody);
      screen.appendChild(entryWrap);

      // Instructor note — editable before it reaches a real person, then sent
      // over Slack with the reply pulled back in (the sync loop).
      if (r.instructorDraft) renderInstructorNote(screen, r);

      const btn = el("button", "btn-secondary", "Start new check-in");
      btn.style.marginTop = "0.5rem";
      btn.addEventListener("click", () => {
        s.phase = "idle"; s.date = null; s.askResult = null;
        s.syncResult = null; s.pendingAnswers = null; s.error = null;
        s.slackSent = false; s.slackMsg = ""; s.slackMsgCls = "";
        draw();
      });
      screen.appendChild(btn);
    }

    checkinRoot.appendChild(screen);
  }

  // Guard the manual "Start check-in" while a Slack check-in is pending: first
  // click warns (auto-clears after 5s); a second click proceeds and cancels the
  // Slack flow, so any reply that arrives is ignored.
  function onStartCheckin() {
    if (s.slackSent && !s.manualArmed) {
      s.manualArmed = true;
      s.manualWarn = "Are you sure? You have a Slack check-in pending. " +
        "Click “Start check-in” again to do it manually — this cancels the Slack one.";
      draw();
      clearTimeout(s.manualTimer);
      s.manualTimer = setTimeout(() => { s.manualArmed = false; s.manualWarn = ""; draw(); }, 5000);
      return;
    }
    clearTimeout(s.manualTimer);
    s.manualArmed = false; s.manualWarn = "";
    if (s.slackSent) {
      s.slackSent = false; s.slackMsg = ""; s.slackMsgCls = "";
      api("POST", "/api/checkin/cancel-slack").catch(() => {});
    }
    doAsk();
  }

  async function doAsk(opts = {}) {
    s.phase = "asking"; s.error = null;
    draw();
    try {
      const result = await api("POST", "/api/ask", { allowEmpty: !!opts.allowEmpty });
      s.askResult = result;
      s.date = result.date;
      s.phase = "questions";
    } catch (e) {
      s.error = e.status === 409
        ? "The agent is busy with another request. Please wait a moment and try again."
        : (e.message || "Something went wrong. Please try again.");
      s.phase = "idle";
    }
    draw();
  }

  async function doSync(questions, textareas) {
    const answers = questions.map((question, i) => ({
      question,
      answer: textareas[i].value.trim(),
    }));
    s.pendingAnswers = answers.map((a) => a.answer);
    s.phase = "generating"; s.error = null;
    draw();
    try {
      const result = await api("POST", "/api/sync", { date: s.date, answers });
      s.syncResult = result;
      s.phase = "done";
    } catch (e) {
      s.error = e.status === 409
        ? "The agent is busy. Please wait a moment and try again."
        : (e.message || "Something went wrong generating the entry. Please try again.");
      s.phase = "questions";
    }
    draw();
  }

  // Check-in via Slack: first click generates the questions and DMs them to the
  // builder; the button then reads "Sync with Slack" and stays there until a
  // reply comes back, at which point the entry is generated.
  async function doSlackCheckin(btn, statusEl) {
    btn.disabled = true;
    statusEl.className = "slack-action-status";
    try {
      if (!s.slackSent) {
        statusEl.textContent = "Preparing your check-in…";
        const ask = await api("POST", "/api/ask");
        if (!ask.changed) {
          statusEl.className = "slack-action-status warn";
          statusEl.textContent = "No new work since your last check-in.";
          btn.disabled = false;
          return;
        }
        s.askResult = ask;
        s.date = ask.date;
        statusEl.textContent = "Sending to Slack…";
        await api("POST", "/api/checkin/send-slack", { questions: ask.questionList });
        s.slackSent = true;
        s.slackMsg = "Sent — answer in Slack, then click Sync with Slack.";
        s.slackMsgCls = "success";
        draw();
      } else {
        statusEl.textContent = "Looking for your Slack replies…";
        const r = await api("POST", "/api/checkin/sync-slack");
        if (!r.synced) {
          statusEl.className = "slack-action-status warn";
          statusEl.textContent = "No replies yet — answer in Slack, then click again.";
          btn.disabled = false;
        } else {
          s.syncResult = r;
          s.phase = "done";
          draw();
        }
      }
    } catch (e) {
      statusEl.className = "slack-action-status error";
      statusEl.textContent = "Failed: " + e.message;
      btn.disabled = false;
    }
  }

  draw();
  drawWeekPanel(weekRoot);

  // Resume an in-flight Slack check-in from server state, the same way the weekly
  // panel reads awaitingInstructor — so the button shows "Sync with Slack" if a
  // reply is still pending, even across reloads.
  if (appConfig && appConfig.chatSurface === "slack") {
    api("GET", "/api/checkin/status")
      .then((st) => {
        if (st.awaiting && s.phase === "idle" && !s.slackSent) {
          s.slackSent = true;
          s.slackMsg = "Answer in Slack, then click Sync with Slack.";
          s.slackMsgCls = "success";
          draw();
        }
      })
      .catch(() => {});
  }
}

// ── Instructor note (done phase) ────────────────────────────────────────────
// Render the "For your instructor" note so the builder can EDIT it before it
// reaches a real person, send it over Slack, and pull the mentor's reply back
// into the app — the return leg of the sync loop.
function renderInstructorNote(screen, r) {
  const trivial = /nothing needs instructor input/i.test(r.instructorDraft || "");
  const slackOn = appConfig && appConfig.chatSurface === "slack";

  const wrap = el("div", "draft-wrap");
  const labelEl = el("div", "section-label");
  labelEl.appendChild(document.createTextNode("Instructor note "));
  const badge = el("span", "badge-gated", trivial ? "nothing to send" : "draft — not sent");
  labelEl.appendChild(badge);
  wrap.appendChild(labelEl);

  if (trivial || !slackOn) {
    // Nothing to escalate, or no Slack channel to send it over — read-only.
    const body = el("div", "markdown-body");
    body.innerHTML = renderMarkdown(r.instructorDraft || "");
    wrap.appendChild(body);
    if (!trivial && !slackOn) {
      wrap.appendChild(el("p", "muted",
        "Enable Slack in Settings to send this to your mentor and pull their reply back here."));
    }
    screen.appendChild(wrap);
    return;
  }

  // Editable note. The builder owns what gets sent — "record, don't dictate".
  wrap.appendChild(el("p", "muted", "Edit before sending — this goes to your mentor as-is."));
  const ta = el("textarea", "field-input");
  ta.rows = Math.min(12, Math.max(4, (r.instructorDraft || "").split("\n").length + 1));
  ta.value = r.instructorDraft || "";
  wrap.appendChild(ta);

  const actionRow = el("div", "slack-action-row");
  const sendBtn = el("button", "btn-secondary", "Send to instructor via Slack");
  const statusEl = el("span", "slack-action-status", "");
  actionRow.appendChild(sendBtn);
  actionRow.appendChild(statusEl);
  wrap.appendChild(actionRow);

  // Container for the reply-pull affordance, shown after a successful send.
  const replyWrap = el("div");
  wrap.appendChild(replyWrap);

  sendBtn.addEventListener("click", async () => {
    const text = ta.value.trim();
    if (!text) {
      statusEl.className = "slack-action-status warn";
      statusEl.textContent = "Nothing to send.";
      return;
    }
    sendBtn.disabled = true;
    ta.disabled = true;
    statusEl.className = "slack-action-status";
    statusEl.textContent = "Sending…";
    try {
      const result = await api("POST", "/api/send-instructor", { date: r.date, text });
      if (result.ok) {
        statusEl.className = "slack-action-status success";
        statusEl.textContent = "Sent to instructor.";
        badge.className = "badge-sent";
        badge.textContent = "sent";
        renderReplySync(replyWrap);
      } else {
        statusEl.className = "slack-action-status warn";
        statusEl.textContent = result.reason || "Nothing to send.";
        sendBtn.disabled = false;
        ta.disabled = false;
      }
    } catch (e) {
      statusEl.className = "slack-action-status error";
      statusEl.textContent = "Failed: " + e.message;
      sendBtn.disabled = false;
      ta.disabled = false;
    }
  });

  screen.appendChild(wrap);
}

// After a note is sent, let the builder pull the mentor's reply back in. The
// reply is also folded into the instructor thread server-side so it informs the
// next synthesis.
function renderReplySync(container) {
  container.innerHTML = "";
  const row = el("div", "slack-action-row");
  const btn = el("button", "btn-ghost", "Check for your mentor's reply");
  const status = el("span", "slack-action-status", "");
  row.appendChild(btn);
  row.appendChild(status);
  container.appendChild(row);

  btn.addEventListener("click", async () => {
    btn.disabled = true;
    status.className = "slack-action-status";
    status.textContent = "Looking for a reply…";
    try {
      const r = await api("POST", "/api/instructor/sync-reply");
      if (!r.synced) {
        status.className = "slack-action-status warn";
        status.textContent = "No reply yet — check back after your mentor responds.";
        btn.disabled = false;
        return;
      }
      status.className = "slack-action-status success";
      status.textContent = "Reply received.";
      const reply = el("div", "info-box");
      reply.appendChild(el("div", "section-label", "From your mentor"));
      const body = el("div", "markdown-body");
      body.innerHTML = renderMarkdown(r.reply || "");
      reply.appendChild(body);
      container.appendChild(reply);
    } catch (e) {
      status.className = "slack-action-status error";
      status.textContent = "Failed: " + e.message;
      btn.disabled = false;
    }
  });
}

// ── "This week" panel — objectives / progress / blockers, set via web or Slack ──
// Rendered below the daily check-in. Self-managing: owns its own fetch + redraw.
function drawWeekPanel(root) {
  const st = {
    data: null, mode: "view", error: null, draftObjectives: "",
    manualArmed: false, manualWarn: null, manualTimer: null,
  };

  function load() {
    root.innerHTML = "";
    root.appendChild(spinner("Loading this week…"));
    api("GET", "/api/week")
      .then((d) => { st.data = d; st.mode = "view"; st.error = null; render(); })
      .catch((e) => {
        root.innerHTML = "";
        root.appendChild(errorBox("Failed to load this week: " + e.message));
      });
  }

  function bulletList(cls, items, fmt) {
    const ul = el("ul", cls);
    items.forEach((it) => {
      const li = document.createElement("li");
      li.textContent = fmt(it);
      ul.appendChild(li);
    });
    return ul;
  }

  function render() {
    root.innerHTML = "";
    const d = st.data || {};
    const panel = el("div", "screen week-panel");

    // Mirror the daily check-in header: h1 + screen-desc subtitle.
    panel.appendChild(el("h1", null, "This week"));
    panel.appendChild(el("p", "screen-desc",
      "Your objectives for the week — set them yourself, or pull them from your instructor over Slack."));

    // Keep the person you're syncing with — and what they're measuring you
    // against — in view while you log.
    const instr = (appConfig && appConfig.instructor) || {};
    if (instr.name || instr.currentGoal) {
      const mc = el("div", "mentor-context");
      if (instr.name) {
        const who = el("div", "mentor-line");
        who.appendChild(el("span", "mentor-key", "Mentor"));
        who.appendChild(el("span", "mentor-val", esc(instr.name)));
        mc.appendChild(who);
      }
      if (instr.currentGoal) {
        const g = el("div", "mentor-line");
        g.appendChild(el("span", "mentor-key", "Goal"));
        g.appendChild(el("span", "mentor-val", esc(instr.currentGoal)));
        mc.appendChild(g);
      }
      panel.appendChild(mc);
    }

    // Nudge when triage is still running on generic defaults — the mentor hasn't
    // calibrated yet. Made actionable (ask via Slack) in the Instructor settings.
    const prefsDefault = instr.name && (!instr.preferencesSource || instr.preferencesSource === "default");
    if (prefsDefault) {
      panel.appendChild(infoBox(
        "Your mentor hasn't set their preferences yet, so instructor notes use generic " +
        "defaults. Calibrate them in Settings → Instructor for sharper, on-target updates."));
    }

    if (st.error) panel.appendChild(errorBox(st.error));

    if (d.awaitingInstructor) {
      panel.appendChild(infoBox(
        "Waiting for your instructor's priorities in Slack. Click “Sync with Slack” to pull their reply."));
    }

    if (st.mode === "edit") {
      panel.appendChild(el("p", "muted", "One objective per line. Keep it short and high-level."));
      const ta = el("textarea", "field-input");
      ta.rows = 4;
      ta.value = st.draftObjectives;
      ta.placeholder = "e.g. Ship the onboarding flow";
      ta.addEventListener("input", () => { st.draftObjectives = ta.value; });
      panel.appendChild(ta);

      const actions = el("div", "week-actions");
      const saveBtn = el("button", "btn-primary", "Save");
      saveBtn.addEventListener("click", () => saveObjectives(ta.value));
      const suggestBtn = el("button", "btn-secondary", "Suggest");
      suggestBtn.addEventListener("click", () => suggest(ta, suggestBtn));
      const cancelBtn = el("button", "btn-ghost", "Cancel");
      cancelBtn.addEventListener("click", () => { st.mode = "view"; render(); });
      actions.appendChild(saveBtn);
      actions.appendChild(suggestBtn);
      actions.appendChild(cancelBtn);
      panel.appendChild(actions);
      root.appendChild(panel);
      return;
    }

    const objs = d.objectives || [];
    if (objs.length) {
      panel.appendChild(el("div", "section-label", "Objectives"));
      panel.appendChild(bulletList("week-objectives", objs, (o) => (o.done ? "✓ " : "• ") + o.text));
    } else if (!d.awaitingInstructor) {
      panel.appendChild(el("p", "muted", "No objectives set for this week yet."));
    }

    if ((d.progress || []).length) {
      panel.appendChild(el("div", "section-label", "Progress"));
      panel.appendChild(bulletList("week-progress", d.progress.slice(-6), (p) => p));
    }
    if ((d.blockers || []).length) {
      panel.appendChild(el("div", "section-label", "Blockers"));
      panel.appendChild(bulletList("week-blockers", d.blockers,
        (b) => b.text + (b.count > 1 ? ` (seen ${b.count}x)` : "")));
    }
    if ((d.whereToLook || []).length) {
      panel.appendChild(el("div", "section-label", "Where to look"));
      panel.appendChild(bulletList("week-where", d.whereToLook, (w) => w));
    }

    const actions = el("div", "week-actions");
    const setBtn = el("button", "btn-primary", objs.length ? "Update priorities" : "Set priorities");
    setBtn.addEventListener("click", () => onSetPriorities(objs));
    actions.appendChild(setBtn);
    if (d.slackEnabled) {
      // Mirrors the daily button: "Ask instructor via Slack" until an ask is
      // outstanding, then "Sync with Slack" until the reply is pulled in.
      const syncBtn = el("button", "btn-secondary",
        d.awaitingInstructor ? "Sync with Slack" : "Ask instructor via Slack");
      syncBtn.addEventListener("click", () => slackSync(syncBtn));
      actions.appendChild(syncBtn);
    }
    panel.appendChild(actions);

    if (st.manualWarn) {
      const w = el("div", "confirm-warn");
      w.textContent = st.manualWarn;
      panel.appendChild(w);
    }
    root.appendChild(panel);
  }

  // Guard manual "Set/Update priorities" while awaiting the instructor in Slack:
  // first click warns (auto-clears after 5s); a second click proceeds and cancels
  // the pending instructor request, so their reply is ignored.
  function onSetPriorities(objs) {
    const awaiting = st.data && st.data.awaitingInstructor;
    if (awaiting && !st.manualArmed) {
      st.manualArmed = true;
      st.manualWarn = "Are you sure? You're waiting on your instructor in Slack. " +
        "Click the button again to set priorities manually — this cancels the Slack request.";
      render();
      clearTimeout(st.manualTimer);
      st.manualTimer = setTimeout(() => { st.manualArmed = false; st.manualWarn = null; render(); }, 5000);
      return;
    }
    clearTimeout(st.manualTimer);
    st.manualArmed = false; st.manualWarn = null;
    if (awaiting) {
      api("POST", "/api/week/cancel-slack").catch(() => {});
      if (st.data) st.data.awaitingInstructor = false;
    }
    st.draftObjectives = (objs || []).map((o) => o.text).join("\n");
    st.mode = "edit";
    render();
  }

  async function saveObjectives(text) {
    const items = text.split("\n").map((s) => s.trim()).filter(Boolean);
    try {
      await api("POST", "/api/week/objectives", { objectives: items });
      load();
    } catch (e) {
      st.error = "Save failed: " + e.message;
      render();
    }
  }

  async function suggest(ta, btn) {
    btn.disabled = true;
    const prev = btn.textContent;
    btn.textContent = "Thinking…";
    try {
      const r = await api("POST", "/api/week/suggest");
      if (r.objectives && r.objectives.length) {
        const base = ta.value.trim();
        ta.value = (base ? base + "\n" : "") + r.objectives.join("\n");
        st.draftObjectives = ta.value;
      } else {
        st.error = "No suggestions returned.";
        render();
        return;
      }
    } catch (e) {
      st.error = "Suggest failed: " + e.message;
      render();
      return;
    }
    btn.disabled = false;
    btn.textContent = prev;
  }

  // Sync with Slack: if no ask is outstanding, DM the instructor for priorities;
  // otherwise pull their reply and set this week's objectives.
  async function slackSync(btn) {
    btn.disabled = true;
    st.error = null;
    const awaiting = st.data && st.data.awaitingInstructor;
    btn.textContent = awaiting ? "Syncing…" : "Asking…";
    try {
      if (!awaiting) {
        await api("POST", "/api/week/ask-instructor", {});
        load();
      } else {
        const r = await api("POST", "/api/week/collect");
        if (!r.collected) {
          st.error = "No reply yet — try again in a moment.";
          render();
        } else {
          load();
        }
      }
    } catch (e) {
      st.error = "Slack sync failed: " + e.message;
      render();
    }
  }

  load();
}

// ─────────────────────────────────────────────────────────────────────────────
// SCREEN 2 — History & status (#/history)
// ─────────────────────────────────────────────────────────────────────────────

function renderHistory(container) {
  container.innerHTML = "";
  const screen = el("div", "screen history-screen");
  screen.appendChild(el("h1", null, "History"));

  const layout = el("div", "history-layout");

  // "This week so far" — the trajectory at a glance (objectives done/open +
  // recurring blockers). This is the arc mentorship needs, not just points.
  const weekPanel = el("div", "status-panel");
  weekPanel.appendChild(spinner("Loading…"));
  layout.appendChild(weekPanel);

  // "Shared with your mentor" — a record of what was escalated and whether the
  // mentor replied.
  const mentorPanel = el("div", "status-panel");
  layout.appendChild(mentorPanel);

  // Project-plan panel (read-only).
  const statusPanel = el("div", "status-panel");
  layout.appendChild(statusPanel);

  // Logs panel
  const logsPanel = el("div", "logs-panel");
  logsPanel.appendChild(el("h2", null, "Past entries"));
  const logsList = el("div", "logs-list");
  logsList.appendChild(spinner("Loading…"));
  logsPanel.appendChild(logsList);
  layout.appendChild(logsPanel);

  // Log viewer (hidden until a date is clicked)
  const logViewer = el("div", "log-viewer");
  logViewer.style.display = "none";
  layout.appendChild(logViewer);

  screen.appendChild(layout);
  container.appendChild(screen);

  // Each panel loads independently so one failure doesn't blank the screen.
  api("GET", "/api/week")
    .then((w) => drawWeekTrajectory(weekPanel, w))
    .catch(() => { weekPanel.style.display = "none"; });

  api("GET", "/api/instructor/notes")
    .then((d) => drawMentorPanel(mentorPanel, d.notes || []))
    .catch(() => { mentorPanel.style.display = "none"; });

  api("GET", "/api/plan/project")
    .then((project) => { statusPanel.innerHTML = ""; drawProjectPanel(statusPanel, project); })
    .catch((e) => {
      statusPanel.innerHTML = "";
      statusPanel.appendChild(errorBox("Failed to load project plan: " + e.message));
    });

  api("GET", "/api/logs")
    .then((logs) => {
      logsList.innerHTML = "";
      if (!logs.length) {
        logsList.appendChild(el("p", "muted",
          "No log entries yet. Complete a check-in to create your first one."));
      } else {
        logs.forEach(({ date }) => {
          const btn = el("button", "log-item", esc(date));
          btn.addEventListener("click", () => loadLog(date, btn));
          logsList.appendChild(btn);
        });
      }
    })
    .catch((e) => { logsList.innerHTML = ""; logsList.appendChild(errorBox("Failed to load logs: " + e.message)); });

  function drawWeekTrajectory(panel, w) {
    panel.innerHTML = "";
    panel.appendChild(el("h2", null, "This week so far"));
    panel.appendChild(el("p", "muted", "Week of " + esc(w.weekOf)));

    const objs = w.objectives || [];
    if (objs.length) {
      const done = objs.filter((o) => o.done).length;
      const sec = el("div", "status-section");
      sec.appendChild(el("h3", null, `Objectives — ${done}/${objs.length} done`));
      const ul = el("ul", "week-objectives");
      objs.forEach((o) => {
        const li = document.createElement("li");
        if (o.done) li.className = "done";
        li.textContent = (o.done ? "✓ " : "• ") + o.text;
        ul.appendChild(li);
      });
      sec.appendChild(ul);
      panel.appendChild(sec);
    } else {
      panel.appendChild(el("p", "muted", "No objectives set this week."));
    }

    if ((w.blockers || []).length) {
      const sec = el("div", "status-section");
      sec.appendChild(el("h3", null, "Blockers"));
      const ul = el("ul", "week-blockers");
      w.blockers.forEach((b) => {
        const li = document.createElement("li");
        li.textContent = b.text + (b.count > 1 ? ` (seen ${b.count}×)` : "");
        ul.appendChild(li);
      });
      sec.appendChild(ul);
      panel.appendChild(sec);
    }
  }

  function drawMentorPanel(panel, notes) {
    panel.innerHTML = "";
    panel.appendChild(el("h2", null, "Shared with your mentor"));
    if (!notes.length) {
      panel.appendChild(el("p", "muted",
        "Nothing shared yet. After a check-in, send the instructor note from the check-in screen."));
      return;
    }
    const list = el("div", "mentor-notes");
    notes.forEach((n) => {
      const item = el("div", "mentor-note");
      item.appendChild(el("span", "mentor-note-date", esc(n.date)));
      const badges = el("span", "note-badges");
      badges.appendChild(el("span", n.sent ? "badge-sent" : "badge-gated", n.sent ? "sent" : "draft"));
      if (n.replied) badges.appendChild(el("span", "badge-rec", "reply"));
      item.appendChild(badges);
      list.appendChild(item);
    });
    panel.appendChild(list);
  }

  function drawProjectPanel(panel, project) {
    panel.appendChild(el("h2", null, "Project plan"));
    if (project && project.markdown && project.markdown.trim()) {
      const body = el("div", "markdown-body");
      body.innerHTML = renderMarkdown(project.markdown);
      panel.appendChild(body);
    } else {
      panel.appendChild(el("p", "muted",
        "No project plan yet. Generate or edit it in Settings → Plans."));
    }
  }

  async function loadLog(date, btn) {
    document.querySelectorAll(".log-item").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    logViewer.style.display = "block";
    logViewer.innerHTML = "";
    logViewer.appendChild(spinner(`Loading ${date}…`));
    try {
      const { markdown } = await api("GET", `/api/logs/${date}`);
      logViewer.innerHTML = "";
      const closeBtn = el("button", "btn-ghost close-btn", "Close");
      closeBtn.addEventListener("click", () => {
        logViewer.style.display = "none";
        btn.classList.remove("active");
      });
      logViewer.appendChild(closeBtn);
      const body = el("div", "markdown-body");
      body.innerHTML = renderMarkdown(markdown);
      logViewer.appendChild(body);
    } catch (e) {
      logViewer.innerHTML = "";
      logViewer.appendChild(errorBox(`Could not load log for ${date}: ${e.message}`));
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Folder picker component (shared by Onboard + Settings)
// ─────────────────────────────────────────────────────────────────────────────

function renderFolderPicker(container, initialPath, onSelect) {
  let currentPath = initialPath || null;

  const wrap = el("div", "folder-picker");

  const selDisplay = el("div", "folder-selected",
    currentPath ? "Current: " + currentPath : "No folder selected yet.");
  if (currentPath) selDisplay.classList.add("active");

  // Native OS folder chooser — the local server pops the real Finder/Explorer
  // dialog and hands back the chosen absolute path. Works on macOS and Windows.
  const isWin = navigator.platform.indexOf("Win") === 0;
  const browseLabel = isWin ? "Choose folder… (open Explorer)" : "Choose folder… (open Finder)";
  const browseRow = el("div", "folder-browse-row");
  const browseBtn = el("button", "btn-primary", browseLabel);
  const browseStatus = el("span", "slack-action-status", "");
  browseBtn.addEventListener("click", async () => {
    browseBtn.disabled = true;
    browseStatus.className = "slack-action-status";
    browseStatus.textContent = "Opening file picker…";
    try {
      const r = await api("GET", "/api/pick-folder");
      if (r.path) {
        onSelect(r.path);
        currentPath = r.path;
        selDisplay.textContent = "Selected: " + r.path;
        selDisplay.classList.add("active");
        browseStatus.textContent = "";
      } else if (r.canceled) {
        browseStatus.textContent = "Canceled.";
      } else {
        browseStatus.className = "slack-action-status warn";
        browseStatus.textContent = r.error || "Could not open the picker.";
      }
    } catch (e) {
      browseStatus.className = "slack-action-status error";
      browseStatus.textContent = "Failed: " + e.message;
    }
    browseBtn.disabled = false;
  });
  browseRow.appendChild(browseBtn);
  browseRow.appendChild(browseStatus);

  wrap.appendChild(browseRow);
  wrap.appendChild(selDisplay);
  container.appendChild(wrap);
}

// ─────────────────────────────────────────────────────────────────────────────
// SCREEN 3 — Onboarding wizard (#/onboard)
// ─────────────────────────────────────────────────────────────────────────────

function renderOnboard(container) {
  let step = 0;
  let providers = [];

  // Draft config — pre-fill from existing appConfig if available
  const cfg = appConfig || {};
  const draft = {
    provider: cfg.provider || "claude-p",
    openrouter: { model: cfg.openrouter?.model || "openai/gpt-4o-mini" },
    root: cfg.root || null,
    builder: Object.assign({ name: "", project: "", context: "", voice: "" }, cfg.builder || {}),
    instructor: Object.assign(
      { name: "", caresAbout: [], wantsFlaggedEarly: [], cadence: "weekly",
        format: "", notUseful: "", currentGoal: "" },
      cfg.instructor || {}
    ),
  };

  const STEPS = ["Provider", "Watch folder", "Builder info", "Instructor", "Review & save", "Project plan"];

  function draw() {
    container.innerHTML = "";
    const screen = el("div", "screen onboard-screen");

    // Header + progress
    screen.appendChild(el("h1", null, "Setup"));
    screen.appendChild(el("p", "wizard-step-label",
      `Step ${step + 1} of ${STEPS.length} — ${esc(STEPS[step])}`));

    const prog = el("div", "wizard-progress");
    const fill = el("div", "wizard-progress-fill");
    fill.style.width = `${((step + 1) / STEPS.length * 100).toFixed(0)}%`;
    prog.appendChild(fill);
    screen.appendChild(prog);

    const body = el("div", "wizard-body");
    if      (step === 0) renderStepProvider(body);
    else if (step === 1) renderStepFolder(body);
    else if (step === 2) renderStepBuilder(body);
    else if (step === 3) renderStepInstructor(body);
    else if (step === 4) renderStepReview(body);
    else if (step === 5) renderStepProjectPlan(body);
    screen.appendChild(body);

    container.appendChild(screen);

    // Fetch providers once
    if (step === 0 && !providers.length) {
      api("GET", "/api/providers").then((p) => { providers = p; draw(); }).catch(() => {});
    }
  }

  function nav(delta) {
    step = Math.max(0, Math.min(STEPS.length - 1, step + delta));
    draw();
  }

  // ── Step 0 — Provider ──
  function renderStepProvider(body) {
    body.appendChild(el("h2", null, "How should Builder Log think with you?"));
    body.appendChild(el("p", "muted",
      "Claude Code is the recommended choice — it uses the Claude app you already have, no separate API key needed."));

    if (!providers.length) {
      body.appendChild(spinner("Loading providers…"));
      addNav(body);
      return;
    }

    const list = el("div", "provider-list");
    providers.forEach((p) => {
      const lbl = document.createElement("label");
      lbl.className = "provider-option" + (draft.provider === p.id ? " selected" : "");

      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = "onboard-provider";
      radio.value = p.id;
      radio.checked = draft.provider === p.id;
      radio.addEventListener("change", () => {
        draft.provider = p.id;
        list.querySelectorAll(".provider-option").forEach((el) => el.classList.remove("selected"));
        lbl.classList.add("selected");
        const row = document.getElementById("or-model-row");
        if (row) row.style.display = p.id === "openrouter" ? "block" : "none";
      });

      lbl.appendChild(radio);
      const labelSpan = el("span", "provider-label", esc(p.label));
      lbl.appendChild(labelSpan);
      if (p.id === "claude-p") lbl.appendChild(el("span", "badge-rec", "recommended"));
      if (p.needsKey && !p.available)
        lbl.appendChild(el("span", "badge-warn", "needs OPENROUTER_API_KEY in .env"));

      list.appendChild(lbl);
    });
    body.appendChild(list);

    // OpenRouter model row
    const orRow = el("div");
    orRow.id = "or-model-row";
    orRow.style.display = draft.provider === "openrouter" ? "block" : "none";
    orRow.style.marginTop = "0.75rem";
    orRow.appendChild(el("p", "muted",
      "Add <code>OPENROUTER_API_KEY=sk-…</code> to your <code>.env</code> file (not here)."));

    const modelField = el("div", "field-group");
    modelField.appendChild(el("label", "field-label", "OpenRouter model ID"));
    const modelInput = el("input", "field-input");
    modelInput.type = "text";
    modelInput.value = draft.openrouter.model || "";
    modelInput.placeholder = "openai/gpt-4o-mini";
    modelInput.addEventListener("input", () => { draft.openrouter.model = modelInput.value; });
    modelField.appendChild(modelInput);
    orRow.appendChild(modelField);
    body.appendChild(orRow);

    addNav(body);
  }

  // ── Step 1 — Folder ──
  function renderStepFolder(body) {
    body.appendChild(el("h2", null, "Which folder should Builder Log watch?"));
    body.appendChild(el("p", "muted",
      "Choose the root of the project you're building. Builder Log tracks file changes here to ask grounded questions."));
    renderFolderPicker(body, draft.root, (p) => { draft.root = p; });
    addNav(body);
  }

  // ── Step 2 — Builder info ──
  function renderStepBuilder(body) {
    body.appendChild(el("h2", null, "Tell us about you and your project"));

    const fields = [
      { key: "name",    label: "Your name",                           placeholder: "e.g. Alex",                                required: true },
      { key: "project", label: "What are you building?",              placeholder: "One line: the project in plain language",  required: true },
      { key: "context", label: "Any helpful context? (optional)",     placeholder: "Solo? Stack? Stage? Skip if unsure." },
      { key: "voice",   label: "Writing voice? (optional)",           placeholder: "e.g. Plain and direct. No hype." },
    ];

    fields.forEach(({ key, label, placeholder, required }) => {
      const grp = el("div", "field-group");
      const lbl = el("label", "field-label",
        esc(label) + (required ? ' <span class="required">*</span>' : ""));
      const input = el("input", "field-input");
      input.type = "text";
      input.value = draft.builder[key] || "";
      input.placeholder = placeholder;
      input.addEventListener("input", () => { draft.builder[key] = input.value; });
      grp.appendChild(lbl);
      grp.appendChild(input);
      body.appendChild(grp);
    });

    addNav(body);
  }

  // ── Step 3 — Instructor ──
  function renderStepInstructor(body) {
    body.appendChild(el("h2", null, "Who is your instructor or mentor?"));
    body.appendChild(el("p", "muted",
      "Builder Log drafts notes for your instructor based on your check-ins. Fill in what you know — you can update everything in Settings later."));

    // Name (required)
    const nameGrp = el("div", "field-group");
    nameGrp.appendChild(el("label", "field-label",
      'Instructor name <span class="required">*</span>'));
    const nameInput = el("input", "field-input");
    nameInput.type = "text";
    nameInput.value = draft.instructor.name || "";
    nameInput.placeholder = "e.g. Dr. Smith";
    nameInput.addEventListener("input", () => { draft.instructor.name = nameInput.value; });
    nameGrp.appendChild(nameInput);
    body.appendChild(nameGrp);

    // Preference fields
    const prefDefs = [
      { key: "caresAbout",       label: "What does your instructor care most about?",  isArray: true,
        placeholder: "One item per line, e.g.:\nReal progress, not just activity\nDecisions that need mentor input" },
      { key: "wantsFlaggedEarly", label: "What should be flagged to them early?",       isArray: true,
        placeholder: "One item per line, e.g.:\nBlockers I can't unblock alone\nBeing stuck in one area for multiple cycles" },
      { key: "cadence",          label: "How often do they want updates?",             placeholder: "e.g. weekly" },
      { key: "format",           label: "Preferred format",                            placeholder: "e.g. Short bullets, signal-only" },
      { key: "notUseful",        label: "What is NOT useful to them?",                 placeholder: "e.g. Activity lists with no outcome" },
      { key: "currentGoal",      label: "Current goal for you (optional)",             placeholder: "e.g. Ship an MVP by end of month" },
    ];

    prefDefs.forEach(({ key, label, placeholder, isArray }) => {
      const grp = el("div", "field-group");
      grp.appendChild(el("label", "field-label", esc(label)));

      if (isArray) {
        const ta = el("textarea", "field-input");
        ta.rows = 3;
        ta.placeholder = placeholder;
        const val = draft.instructor[key];
        ta.value = Array.isArray(val) ? val.join("\n") : (val || "");
        ta.addEventListener("input", () => {
          draft.instructor[key] = ta.value.split("\n").map((s) => s.trim()).filter(Boolean);
        });
        grp.appendChild(ta);
      } else {
        const inp = el("input", "field-input");
        inp.type = "text";
        inp.value = draft.instructor[key] || "";
        inp.placeholder = placeholder;
        inp.addEventListener("input", () => { draft.instructor[key] = inp.value; });
        grp.appendChild(inp);
      }

      body.appendChild(grp);
    });

    // Questionnaire generator
    const qBtn = el("button", "btn-secondary", "Generate questionnaire to send my mentor");
    qBtn.style.marginTop = "1rem";
    const qBox = el("div");
    qBox.style.display = "none";

    qBtn.addEventListener("click", async () => {
      qBtn.disabled = true;
      qBtn.textContent = "Loading…";
      qBox.innerHTML = "";
      qBox.style.display = "block";
      try {
        const { markdown } = await api("GET", "/api/instructor-doc");
        const copyBtn = el("button", "btn-ghost", "Copy to clipboard");
        copyBtn.addEventListener("click", () => {
          navigator.clipboard.writeText(markdown).then(() => {
            copyBtn.textContent = "Copied!";
            setTimeout(() => { copyBtn.textContent = "Copy to clipboard"; }, 2000);
          }).catch(() => {
            copyBtn.textContent = "Select and copy manually";
          });
        });
        qBox.appendChild(copyBtn);
        const pre = el("pre", "doc-pre");
        pre.textContent = markdown;
        qBox.appendChild(pre);
      } catch (e) {
        qBox.appendChild(errorBox("Could not load questionnaire: " + e.message));
      }
      qBtn.disabled = false;
      qBtn.textContent = "Generate questionnaire to send my mentor";
    });

    body.appendChild(qBtn);
    body.appendChild(qBox);

    addNav(body);
  }

  // ── Step 4 — Review & save ──
  function renderStepReview(body) {
    body.appendChild(el("h2", null, "Ready to save"));
    body.appendChild(el("p", "muted",
      "Review your settings, then click Save to start using Builder Log."));

    const items = [
      ["Provider",    draft.provider + (draft.provider === "openrouter" ? ` (${draft.openrouter.model})` : "")],
      ["Watch folder", draft.root || "(not set)"],
      ["Your name",   draft.builder.name || "(not set)"],
      ["Project",     draft.builder.project || "(not set)"],
      ["Context",     draft.builder.context || "(none)"],
      ["Instructor",  draft.instructor.name || "(not set)"],
      ["Cadence",     draft.instructor.cadence || "(default)"],
    ];

    const dl = el("dl", "review-table");
    items.forEach(([label, value]) => {
      dl.appendChild(el("dt", null, esc(label)));
      dl.appendChild(el("dd", null, esc(value)));
    });
    body.appendChild(dl);

    const errBox = el("div");
    body.appendChild(errBox);

    const navRow = el("div", "wizard-nav");

    const back = el("button", "btn-secondary", "Back");
    back.addEventListener("click", () => nav(-1));
    navRow.appendChild(back);

    const save = el("button", "btn-primary", "Save and start");
    save.addEventListener("click", async () => {
      save.disabled = true;
      save.textContent = "Saving…";
      errBox.innerHTML = "";

      const payload = {
        provider:   draft.provider,
        openrouter: draft.openrouter,
        root:       draft.root,
        builder:    draft.builder,
        instructor: draft.instructor,
      };

      try {
        const result = await api("POST", "/api/config", payload);
        appConfig = result.config;

        if (result.missing && result.missing.length) {
          errBox.appendChild(errorBox(
            "Missing required fields: " + result.missing.join(", ") +
            ". Please go back and fill them in."));
          save.disabled = false;
          save.textContent = "Save and start";
          return;
        }

        // Config is saved — show the full nav and move to the project-plan step,
        // which generates/copies against the now-saved config.
        buildNav(true);
        nav(1);
      } catch (e) {
        errBox.appendChild(errorBox("Save failed: " + e.message));
        save.disabled = false;
        save.textContent = "Save and start";
      }
    });
    navRow.appendChild(save);
    body.appendChild(navRow);
  }

  // ── Step 5 — Project plan (runs after the config is saved) ──
  function renderStepProjectPlan(body) {
    body.appendChild(el("h2", null, "Your project plan"));
    body.appendChild(el("p", "muted",
      "The high-level overview the agent works from (it refreshes weekly, not daily). " +
      "Generate it now, copy a prompt to create it elsewhere, or skip and do it later in Settings."));

    // Greenfield vs existing.
    let mode = "existing";
    const modeWrap = el("div", "field-group");
    modeWrap.appendChild(el("label", "field-label", "Starting fresh, or mapping existing work?"));
    const modeList = el("div", "provider-list");
    [
      ["existing", "I have existing work in this folder — map it"],
      ["scaffold", "I'm starting fresh — propose a structure"],
    ].forEach(([val, label]) => {
      const lbl = document.createElement("label");
      lbl.className = "provider-option" + (mode === val ? " selected" : "");
      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = "pp-mode";
      radio.value = val;
      radio.checked = mode === val;
      radio.addEventListener("change", () => {
        mode = val;
        modeList.querySelectorAll(".provider-option").forEach((e) => e.classList.remove("selected"));
        lbl.classList.add("selected");
      });
      lbl.appendChild(radio);
      lbl.appendChild(el("span", "provider-label", label));
      modeList.appendChild(lbl);
    });
    modeWrap.appendChild(modeList);
    body.appendChild(modeWrap);

    const ta = el("textarea", "field-input prompt-input");
    ta.rows = 10;
    ta.placeholder = "# Project Plan — …";

    const actions = el("div", "week-actions");
    const genBtn = el("button", "btn-primary", "Generate with agent");
    const copyBtn = el("button", "btn-ghost");
    copyBtn.title = "Copy a prompt to (re)create the project plan in the correct format";
    copyBtn.innerHTML = COPY_ICON_SVG + " Copy prompt";
    const status = el("span", "slack-action-status", "");
    actions.appendChild(genBtn);
    actions.appendChild(copyBtn);
    actions.appendChild(status);

    let promptText = "";
    api("GET", "/api/plan/project")
      .then((r) => { if (r.markdown) ta.value = r.markdown; promptText = r.prompt || ""; })
      .catch(() => {});

    genBtn.addEventListener("click", async () => {
      genBtn.disabled = true;
      status.className = "slack-action-status";
      status.textContent = "Generating…";
      try {
        const r = await api("POST", "/api/plan/project/generate", { mode });
        ta.value = r.markdown || "";
        status.className = "slack-action-status success";
        status.textContent = "Generated.";
      } catch (e) {
        status.className = "slack-action-status error";
        status.textContent = "Failed: " + e.message;
      }
      genBtn.disabled = false;
    });
    copyBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(promptText || "");
        copyBtn.innerHTML = COPY_ICON_SVG + " Copied!";
        setTimeout(() => { copyBtn.innerHTML = COPY_ICON_SVG + " Copy prompt"; }, 1500);
      } catch {
        status.className = "slack-action-status warn";
        status.textContent = "Clipboard blocked — prompt logged to console.";
        console.log(promptText);
      }
    });

    body.appendChild(ta);
    body.appendChild(actions);

    const navRow = el("div", "wizard-nav");
    const finish = el("button", "btn-primary", "Finish");
    finish.addEventListener("click", async () => {
      finish.disabled = true;
      finish.textContent = "Saving…";
      try {
        if (ta.value.trim()) await api("POST", "/api/plan/project", { markdown: ta.value });
      } catch {
        // Non-fatal — the plan can still be edited later in Settings.
      }
      navigate("#/checkin");
      handleRoute();
    });
    navRow.appendChild(finish);
    body.appendChild(navRow);
  }

  // ── Shared nav row (used by steps 0–3) ──
  function addNav(body) {
    if (step === STEPS.length - 1) return; // review step handles its own nav

    const row = el("div", "wizard-nav");

    if (step > 0) {
      const back = el("button", "btn-secondary", "Back");
      back.addEventListener("click", () => nav(-1));
      row.appendChild(back);
    }

    const isLast = step === STEPS.length - 2;
    const next = el("button", "btn-primary", isLast ? "Review" : "Next");
    next.addEventListener("click", () => {
      if (step === 2 && !draft.builder.name.trim()) {
        alert("Please enter your name before continuing.");
        return;
      }
      if (step === 3 && !draft.instructor.name.trim()) {
        alert("Please enter your instructor's name before continuing.");
        return;
      }
      nav(1);
    });
    row.appendChild(next);
    body.appendChild(row);
  }

  draw();
}

// ─────────────────────────────────────────────────────────────────────────────
// SCREEN 4 — Settings (#/settings)
// ─────────────────────────────────────────────────────────────────────────────

function renderSettings(container) {
  container.innerHTML = "";
  const screen = el("div", "screen settings-screen");
  screen.appendChild(el("h1", null, "Settings"));
  screen.appendChild(spinner("Loading…"));
  container.appendChild(screen);

  Promise.all([
    api("GET", "/api/config"),
    api("GET", "/api/providers"),
    api("GET", "/api/prompts/defaults"),
  ])
    .then(([cfg, providers, promptDefaults]) => {
      screen.innerHTML = "";
      screen.appendChild(el("h1", null, "Settings"));
      renderSettingsForm(screen, cfg, providers, promptDefaults);
    })
    .catch((e) => {
      screen.innerHTML = "";
      screen.appendChild(el("h1", null, "Settings"));
      screen.appendChild(errorBox("Failed to load settings: " + e.message));
    });
}

function renderSettingsForm(container, cfg, providers, promptDefaults = {}) {
  // Deep clone so edits don't mutate the original
  let draft = JSON.parse(JSON.stringify(cfg));

  // Collapsible section (native <details>): callers appendChild content, which
  // lands in the disclosure body after the <summary> header. First one opens.
  let sectionCount = 0;
  function section(title, opts = {}) {
    const sec = el("details", "settings-section");
    if (opts.open || (opts.open === undefined && sectionCount === 0)) sec.open = true;
    sectionCount++;
    sec.appendChild(el("summary", "settings-summary", esc(title)));
    return sec;
  }

  function makeField(label, value, opts = {}) {
    const grp = el("div", "field-group");
    grp.appendChild(el("label", "field-label", esc(label)));

    let input;
    if (opts.isArray) {
      input = el("textarea", "field-input");
      input.rows = opts.rows || 2;
      input.placeholder = opts.placeholder || "";
      input.value = Array.isArray(value) ? value.join("\n") : (value || "");
    } else if (opts.textarea) {
      input = el("textarea", "field-input");
      input.rows = opts.rows || 2;
      input.placeholder = opts.placeholder || "";
      input.value = value || "";
    } else if (opts.type === "checkbox") {
      input = el("input", "field-checkbox");
      input.type = "checkbox";
      input.checked = !!value;
    } else {
      input = el("input", "field-input");
      input.type = opts.type || "text";
      input.placeholder = opts.placeholder || "";
      input.value = value != null ? String(value) : "";
    }

    grp.appendChild(input);
    return { grp, input };
  }

  // ── Provider ──
  const provSec = section("Provider");

  const provList = el("div", "provider-list");
  let orModelRow; // declared here so radio listener can reference it
  providers.forEach((p) => {
    const lbl = document.createElement("label");
    lbl.className = "provider-option" + (draft.provider === p.id ? " selected" : "");

    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "settings-provider";
    radio.value = p.id;
    radio.checked = draft.provider === p.id;
    radio.addEventListener("change", () => {
      draft.provider = p.id;
      provList.querySelectorAll(".provider-option").forEach((el) => el.classList.remove("selected"));
      lbl.classList.add("selected");
      if (orModelRow) orModelRow.style.display = p.id === "openrouter" ? "block" : "none";
    });

    lbl.appendChild(radio);
    lbl.appendChild(el("span", "provider-label", esc(p.label)));
    if (p.id === "claude-p") lbl.appendChild(el("span", "badge-rec", "recommended"));
    if (p.needsKey && !p.available)
      lbl.appendChild(el("span", "badge-warn", "needs OPENROUTER_API_KEY in .env"));

    provList.appendChild(lbl);
  });
  provSec.appendChild(provList);

  orModelRow = el("div");
  orModelRow.style.display = draft.provider === "openrouter" ? "block" : "none";
  orModelRow.style.marginTop = "0.75rem";
  const orModelF = makeField("OpenRouter model ID", draft.openrouter?.model || "");
  orModelF.input.addEventListener("input", () => {
    if (!draft.openrouter) draft.openrouter = {};
    draft.openrouter.model = orModelF.input.value;
  });
  orModelRow.appendChild(orModelF.grp);
  provSec.appendChild(orModelRow);
  container.appendChild(provSec);

  // ── Tracked folders (roots registry) ──
  const folderSec = section("Tracked folders");
  folderSec.appendChild(el("p", "muted",
    "Folders Builder Log scans for changes. Add as many as you like — work can live " +
    "in more than one place. The first one is the primary folder."));

  if (!Array.isArray(draft.roots)) {
    draft.roots = draft.root
      ? [{ id: "r1", type: "local", path: draft.root, label: baseName(draft.root), summary: "" }]
      : [];
  }

  function baseName(p) {
    return String(p || "").replace(/\/+$/, "").split("/").pop() || String(p || "");
  }
  function nextRootId() {
    let max = 0;
    draft.roots.forEach((r) => { const m = /^r(\d+)$/.exec(r.id || ""); if (m) max = Math.max(max, +m[1]); });
    return "r" + (max + 1);
  }
  function syncPrimaryRoot() {
    draft.root = draft.roots[0] ? draft.roots[0].path : draft.root;
  }

  const rootsList = el("div", "roots-list");
  folderSec.appendChild(rootsList);

  function drawRoots() {
    rootsList.innerHTML = "";
    if (!draft.roots.length) {
      rootsList.appendChild(el("p", "muted", "No folders yet. Add one below."));
    }
    draft.roots.forEach((r, i) => {
      const item = el("div", "root-item");
      const top = el("div", "root-item-top");
      const pathSpan = el("span", "root-path", esc(r.path));
      if (i === 0) pathSpan.appendChild(el("span", "badge-rec", "primary"));
      top.appendChild(pathSpan);
      const rm = el("button", "btn-danger", "Remove");
      rm.addEventListener("click", () => { draft.roots.splice(i, 1); syncPrimaryRoot(); drawRoots(); });
      top.appendChild(rm);
      item.appendChild(top);

      const lblField = makeField("Label", r.label, { placeholder: baseName(r.path) });
      lblField.input.addEventListener("input", () => { r.label = lblField.input.value; });
      item.appendChild(lblField.grp);

      const sumField = makeField("What's here (optional)", r.summary,
        { textarea: true, rows: 2, placeholder: "e.g. the web dashboard frontend" });
      sumField.input.addEventListener("input", () => { r.summary = sumField.input.value; });
      item.appendChild(sumField.grp);

      rootsList.appendChild(item);
    });
  }
  drawRoots();

  const addWrap = el("div");
  addWrap.style.display = "none";
  const addBtn = el("button", "btn-ghost", "Add folder");
  addBtn.addEventListener("click", () => {
    const shown = addWrap.style.display !== "none";
    addWrap.style.display = shown ? "none" : "block";
    addBtn.textContent = shown ? "Add folder" : "Hide picker";
    if (!shown && !addWrap.children.length) {
      renderFolderPicker(addWrap, null, (p) => {
        if (p && !draft.roots.some((r) => r.path === p)) {
          draft.roots.push({ id: nextRootId(), type: "local", path: p, label: baseName(p), summary: "" });
          syncPrimaryRoot();
          drawRoots();
        }
      });
    }
  });
  folderSec.appendChild(addBtn);
  folderSec.appendChild(addWrap);
  container.appendChild(folderSec);

  // ── Builder ──
  const builderSec = section("Builder");
  [
    { k: "name",    label: "Your name",    ph: "e.g. Alex" },
    { k: "project", label: "Project",      ph: "One line: what you're building" },
    { k: "context", label: "Context",      ph: "Solo? Stack? Stage?" },
    { k: "voice",   label: "Voice",        ph: "Plain and direct. No hype." },
  ].forEach(({ k, label, ph }) => {
    const f = makeField(label, draft.builder?.[k], { placeholder: ph });
    f.input.addEventListener("input", () => {
      if (!draft.builder) draft.builder = {};
      draft.builder[k] = f.input.value;
    });
    builderSec.appendChild(f.grp);
  });
  container.appendChild(builderSec);

  // ── Instructor ──
  const instrSec = section("Instructor");
  // Capture field inputs so a mentor calibration sync can repopulate them.
  const instrInputs = {};

  const instrNameF = makeField("Instructor name", draft.instructor?.name, { placeholder: "e.g. Dr. Smith" });
  instrNameF.input.addEventListener("input", () => {
    if (!draft.instructor) draft.instructor = {};
    draft.instructor.name = instrNameF.input.value;
  });
  instrSec.appendChild(instrNameF.grp);
  instrInputs.name = { input: instrNameF.input, isArray: false };

  [
    { k: "caresAbout",        label: "Cares about (one per line)",     isArray: true },
    { k: "wantsFlaggedEarly", label: "Flag early (one per line)",       isArray: true },
    { k: "cadence",           label: "Update cadence",                 ph: "e.g. weekly" },
    { k: "format",            label: "Preferred format",               ph: "e.g. Short bullets" },
    { k: "notUseful",         label: "Not useful",                     ph: "e.g. Activity lists with no outcome" },
    { k: "currentGoal",       label: "Current goal for you",           ph: "" },
  ].forEach(({ k, label, isArray, ph }) => {
    const f = makeField(label, draft.instructor?.[k], { isArray, placeholder: ph });
    f.input.addEventListener("input", () => {
      if (!draft.instructor) draft.instructor = {};
      draft.instructor[k] = isArray
        ? f.input.value.split("\n").map((s) => s.trim()).filter(Boolean)
        : f.input.value;
    });
    instrSec.appendChild(f.grp);
    instrInputs[k] = { input: f.input, isArray: !!isArray };
  });

  // Mentor calibration — let the mentor set the fields above themselves, instead
  // of the student guessing. Copy a questionnaire, or (with Slack) ask + sync.
  renderInstructorCalibration(instrSec, draft, instrInputs);

  container.appendChild(instrSec);

  // ── Slack ──
  const slackSec = section("Slack");
  slackSec.appendChild(el("p", "muted",
    "Turn on Slack to get check-in reminders and deliver instructor notes as DMs. " +
    "It uses your OWN Slack app and token — nothing is shared. Leave off to use the web app only."));

  // Master toggle — drives chatSurface ("slack" when on, "terminal" when off).
  const enableF = makeField("Enable Slack messaging", draft.chatSurface === "slack", { type: "checkbox" });
  slackSec.appendChild(enableF.grp);

  // Everything below is only relevant once Slack is enabled.
  const slackDetails = el("div", "slack-details");

  // Setup guide: the one-time steps, with a link out to the GitHub guide.
  const guide = el("div", "callout");
  guide.appendChild(el("p", "callout-title", "One-time setup"));
  const ol = document.createElement("ol");
  [
    "Create your Slack app from the manifest and install it to your workspace.",
    "Copy the Bot User OAuth token (starts with xoxb-).",
    "Paste it into the Bot token field below and click Save token — it's written to your local .env, never config.",
    "Fill in the Slack user IDs below, then save your settings.",
  ].forEach((t) => {
    const li = document.createElement("li");
    li.textContent = t;
    ol.appendChild(li);
  });
  guide.appendChild(ol);
  const docLink = document.createElement("a");
  docLink.href = "https://github.com/adv129/Builders-Log/blob/main/docs/SLACK_SETUP.md";
  docLink.target = "_blank";
  docLink.rel = "noopener";
  docLink.textContent = "Open the full Slack setup guide on GitHub →";
  guide.appendChild(docLink);
  slackDetails.appendChild(guide);

  // Shared status line for both "Save token" and "Check connection".
  const slackStatus = el("span", "slack-action-status", "");

  // Bot token — written to .env via the server (never to config.json), then
  // hot-loaded so no restart is needed. Left blank on load (the secret is never
  // sent back to the browser); a saved token still works even when the box is empty.
  const tokenF = makeField("Bot token (xoxb-…)", "", { type: "password", placeholder: "xoxb-…  (leave blank to keep current)" });
  slackDetails.appendChild(tokenF.grp);

  const tokenRow = el("div", "slack-action-row");
  const saveTokenBtn = el("button", "btn-secondary", "Save token");
  saveTokenBtn.addEventListener("click", async () => {
    const token = tokenF.input.value.trim();
    if (!token) {
      slackStatus.className = "slack-action-status warn";
      slackStatus.textContent = "Enter a token first (or leave blank to keep the current one).";
      return;
    }
    saveTokenBtn.disabled = true;
    slackStatus.className = "slack-action-status";
    slackStatus.textContent = "Saving…";
    try {
      const r = await api("POST", "/api/slack/token", { token });
      tokenF.input.value = ""; // don't keep the secret in the field
      if (r.connected) {
        slackStatus.className = "slack-action-status success";
        slackStatus.textContent = "✓ Saved. " + r.message;
      } else {
        slackStatus.className = "slack-action-status warn";
        slackStatus.textContent = "Saved, but not verified — " + r.message;
      }
    } catch (e) {
      slackStatus.className = "slack-action-status error";
      slackStatus.textContent = "Failed: " + e.message;
    }
    saveTokenBtn.disabled = false;
  });
  tokenRow.appendChild(saveTokenBtn);
  tokenRow.style.marginBottom = "1.75rem"; // breathing room before the user-ID fields
  slackDetails.appendChild(tokenRow);

  // User ID fields.
  [
    { k: "studentUserId",    label: "Your Slack user ID",        ph: "U0123456789" },
    { k: "instructorUserId", label: "Instructor Slack user ID",  ph: "U9876543210" },
  ].forEach(({ k, label, ph }) => {
    const f = makeField(label, draft.slack?.[k], { placeholder: ph });
    f.input.addEventListener("input", () => {
      if (!draft.slack) draft.slack = {};
      draft.slack[k] = f.input.value || null;
    });
    slackDetails.appendChild(f.grp);
  });
  slackDetails.appendChild(el("p", "muted",
    "To find a Slack user ID: open the profile in Slack → More (⋮) → Copy member ID."));

  const gateF = makeField("Hold instructor messages for review before sending",
    draft.slack?.gateInstructorMessages, { type: "checkbox" });
  gateF.input.addEventListener("change", () => {
    if (!draft.slack) draft.slack = {};
    draft.slack.gateInstructorMessages = gateF.input.checked;
  });
  slackDetails.appendChild(gateF.grp);

  // Connection check — re-verifies the saved token (auth.test).
  const checkRow = el("div", "slack-action-row");
  const checkBtn = el("button", "btn-secondary", "Check connection");
  checkBtn.addEventListener("click", async () => {
    checkBtn.disabled = true;
    slackStatus.className = "slack-action-status";
    slackStatus.textContent = "Checking…";
    try {
      const r = await api("GET", "/api/slack/test");
      if (r.connected) {
        slackStatus.className = "slack-action-status success";
        slackStatus.textContent = "✓ " + r.message;
      } else {
        slackStatus.className = "slack-action-status warn";
        slackStatus.textContent = "Not connected — " + r.message;
      }
    } catch (e) {
      slackStatus.className = "slack-action-status error";
      slackStatus.textContent = "Failed: " + e.message;
    }
    checkBtn.disabled = false;
  });
  checkRow.appendChild(checkBtn);
  checkRow.appendChild(slackStatus);
  slackDetails.appendChild(checkRow);

  slackSec.appendChild(slackDetails);
  container.appendChild(slackSec);

  // Show/hide the details and keep chatSurface in sync with the toggle.
  function syncSlackDetails() {
    const on = enableF.input.checked;
    draft.chatSurface = on ? "slack" : "terminal";
    slackDetails.style.display = on ? "" : "none";
  }
  enableF.input.addEventListener("change", syncSlackDetails);
  syncSlackDetails();

  // ── Prompts ──
  const promptSec = section("Prompts");

  if (!draft.prompts) draft.prompts = {};

  // One editable prompt: textarea pre-filled with the saved override or the
  // default; "Reset to default" clears the override (empty → code uses default).
  function promptField(label, key, help, rows) {
    const def = promptDefaults[key] || "";
    const grp = el("div", "field-group");

    const labelRow = el("div", "prompt-label-row");
    labelRow.appendChild(el("label", "field-label", esc(label)));
    const resetBtn = el("button", "btn-ghost prompt-reset", "Reset to default");
    labelRow.appendChild(resetBtn);
    grp.appendChild(labelRow);

    if (help) grp.appendChild(el("p", "muted prompt-help", help));

    const ta = el("textarea", "field-input prompt-input");
    ta.rows = rows || 4;
    const saved = draft.prompts[key];
    ta.value = (saved != null && saved !== "") ? saved : def;
    if (key === "synthesisGuidance" && !saved) {
      ta.placeholder = "Optional. e.g. Keep bullets under 15 words; prefer past tense.";
      ta.value = saved || "";
    }
    ta.addEventListener("input", () => { draft.prompts[key] = ta.value; });
    resetBtn.addEventListener("click", () => {
      ta.value = (key === "synthesisGuidance") ? "" : def;
      draft.prompts[key] = "";
    });

    grp.appendChild(ta);
    promptSec.appendChild(grp);
  }

  promptField("Agent voice & principles", "thesis",
    "Prepended to every request — the agent's identity and tone.", 4);
  promptField("Interview guidance", "askGuidance",
    "What the check-in questions should surface. The “numbered list only” output format stays fixed.", 6);
  promptField("Entry synthesis guidance (optional)", "synthesisGuidance",
    "Extra steering for the written entry. The three sections (Builder Log / For your instructor / Friction check) stay fixed.", 3);

  container.appendChild(promptSec);

  // ── Plans (project + weekly, editable) ──
  // These save via their own endpoints (not the config draft) since they're
  // markdown files the agent maintains and the human can edit.
  const plansSec = section("Plans", { open: false });
  plansSec.appendChild(el("p", "muted",
    "The project plan (high-level, refreshed weekly) and this week's plan. " +
    "Editable here — the agent also maintains them."));

  // Project plan
  const projGrp = el("div", "field-group");
  const projLabelRow = el("div", "prompt-label-row");
  projLabelRow.appendChild(el("label", "field-label", "Project plan"));
  const copyBtn = el("button", "btn-ghost prompt-reset");
  copyBtn.title = "Copy a prompt to (re)create the project plan in the correct format";
  copyBtn.innerHTML = COPY_ICON_SVG + " Copy prompt";
  projLabelRow.appendChild(copyBtn);
  projGrp.appendChild(projLabelRow);
  const projTa = el("textarea", "field-input prompt-input");
  projTa.rows = 10;
  projTa.placeholder = "# Project Plan — …";
  projGrp.appendChild(projTa);
  const projActions = el("div", "week-actions");
  const projSave = el("button", "btn-secondary", "Save project plan");
  const projGen = el("button", "btn-ghost", "Generate with agent");
  const projStatus = el("span", "slack-action-status", "");
  projActions.appendChild(projSave);
  projActions.appendChild(projGen);
  projActions.appendChild(projStatus);
  projGrp.appendChild(projActions);
  plansSec.appendChild(projGrp);

  let projectPrompt = "";
  copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(projectPrompt || "");
      copyBtn.innerHTML = COPY_ICON_SVG + " Copied!";
      setTimeout(() => { copyBtn.innerHTML = COPY_ICON_SVG + " Copy prompt"; }, 1500);
    } catch {
      projStatus.className = "slack-action-status warn";
      projStatus.textContent = "Clipboard blocked — prompt logged to console.";
      console.log(projectPrompt);
    }
  });
  projSave.addEventListener("click", async () => {
    projSave.disabled = true;
    projStatus.className = "slack-action-status";
    projStatus.textContent = "Saving…";
    try {
      await api("POST", "/api/plan/project", { markdown: projTa.value });
      projStatus.className = "slack-action-status success";
      projStatus.textContent = "Saved.";
    } catch (e) {
      projStatus.className = "slack-action-status error";
      projStatus.textContent = "Failed: " + e.message;
    }
    projSave.disabled = false;
  });
  projGen.addEventListener("click", async () => {
    projGen.disabled = true;
    projStatus.className = "slack-action-status";
    projStatus.textContent = "Generating…";
    try {
      const r = await api("POST", "/api/plan/project/generate", {});
      projTa.value = r.markdown || "";
      projStatus.className = "slack-action-status success";
      projStatus.textContent = "Generated.";
    } catch (e) {
      projStatus.className = "slack-action-status error";
      projStatus.textContent = "Failed: " + e.message;
    }
    projGen.disabled = false;
  });

  // Weekly plan
  const wkGrp = el("div", "field-group");
  wkGrp.appendChild(el("label", "field-label", "This week's plan"));
  const wkTa = el("textarea", "field-input prompt-input");
  wkTa.rows = 10;
  wkTa.placeholder = "# Week of …";
  wkGrp.appendChild(wkTa);
  const wkActions = el("div", "week-actions");
  const wkSave = el("button", "btn-secondary", "Save weekly plan");
  const wkStatus = el("span", "slack-action-status", "");
  wkActions.appendChild(wkSave);
  wkActions.appendChild(wkStatus);
  wkGrp.appendChild(wkActions);
  plansSec.appendChild(wkGrp);

  let planWeekOf = null;
  wkSave.addEventListener("click", async () => {
    wkSave.disabled = true;
    wkStatus.className = "slack-action-status";
    wkStatus.textContent = "Saving…";
    try {
      await api("POST", "/api/plan/week", { markdown: wkTa.value, weekOf: planWeekOf });
      wkStatus.className = "slack-action-status success";
      wkStatus.textContent = "Saved.";
    } catch (e) {
      wkStatus.className = "slack-action-status error";
      wkStatus.textContent = "Failed: " + e.message;
    }
    wkSave.disabled = false;
  });

  // Load current contents.
  api("GET", "/api/plan/project")
    .then((r) => { projTa.value = r.markdown || ""; projectPrompt = r.prompt || ""; })
    .catch(() => {});
  api("GET", "/api/plan/week")
    .then((r) => { wkTa.value = r.markdown || ""; planWeekOf = r.weekOf; })
    .catch(() => {});

  container.appendChild(plansSec);

  // ── Save ──
  const resultArea = el("div");
  container.appendChild(resultArea);

  const saveBtn = el("button", "btn-primary", "Save settings");
  saveBtn.style.marginTop = "0.5rem";
  saveBtn.addEventListener("click", async () => {
    saveBtn.disabled = true;
    saveBtn.textContent = "Saving…";
    resultArea.innerHTML = "";
    try {
      const result = await api("POST", "/api/config", draft);
      appConfig = result.config;
      if (result.missing?.length) {
        resultArea.appendChild(infoBox(
          "Setup is not yet complete. Missing: " + result.missing.join(", ")));
      }
      result.notes?.forEach((n) => resultArea.appendChild(infoBox(n)));
      if (!result.missing?.length) {
        resultArea.appendChild(successBox("Settings saved."));
        buildNav(result.config?.setupComplete);
      }
    } catch (e) {
      resultArea.appendChild(errorBox("Save failed: " + e.message));
    }
    saveBtn.disabled = false;
    saveBtn.textContent = "Save settings";
  });
  container.appendChild(saveBtn);
}

// ── Mentor calibration (Settings → Instructor) ──────────────────────────────
// The mentor's real preferences drive triage quality. This lets them set the
// fields themselves: copy a questionnaire to send any way, or — with Slack —
// ask over DM and pull their free-text answer back, mapped into the fields.
function renderInstructorCalibration(sec, draft, inputs) {
  const slackOn = draft.chatSurface === "slack";

  const wrap = el("div", "calibration-block");
  wrap.appendChild(el("div", "field-label", "Mentor calibration"));
  wrap.appendChild(el("p", "muted",
    "Let your mentor fill in the fields above in their own words — " +
    (slackOn
      ? "ask them over Slack and pull their answers back automatically, or copy the questionnaire to send any way."
      : "copy the questionnaire to send, or enable Slack above to ask and pull answers back automatically.")));

  const row = el("div", "slack-action-row");
  const status = el("span", "slack-action-status", "");

  const copyBtn = el("button", "btn-ghost", "Copy questionnaire");
  copyBtn.addEventListener("click", async () => {
    try {
      const { markdown } = await api("GET", "/api/instructor-doc");
      await navigator.clipboard.writeText(markdown);
      copyBtn.textContent = "Copied!";
      setTimeout(() => { copyBtn.textContent = "Copy questionnaire"; }, 1500);
    } catch (e) {
      status.className = "slack-action-status error";
      status.textContent = "Failed: " + e.message;
    }
  });
  row.appendChild(copyBtn);

  if (slackOn) {
    let awaiting = false;
    const askBtn = el("button", "btn-secondary", "Ask mentor via Slack");
    askBtn.addEventListener("click", async () => {
      askBtn.disabled = true;
      status.className = "slack-action-status";
      try {
        if (!awaiting) {
          status.textContent = "Sending…";
          await api("POST", "/api/instructor/ask-prefs");
          awaiting = true;
          askBtn.textContent = "Sync mentor's answers";
          status.className = "slack-action-status success";
          status.textContent = "Asked — your mentor answers in Slack, then click Sync.";
        } else {
          status.textContent = "Reading reply…";
          const r = await api("POST", "/api/instructor/collect-prefs");
          if (!r.collected) {
            status.className = "slack-action-status warn";
            status.textContent = "No answer yet — try again in a moment.";
          } else {
            applyPrefsToForm(inputs, draft, r.instructor);
            awaiting = false;
            askBtn.textContent = "Ask mentor via Slack";
            status.className = "slack-action-status success";
            status.textContent = "Mentor's preferences applied — review above, then Save settings.";
          }
        }
      } catch (e) {
        status.className = "slack-action-status error";
        status.textContent = "Failed: " + e.message;
      }
      askBtn.disabled = false;
    });
    row.appendChild(askBtn);

    // Resume a pending ask across reloads.
    api("GET", "/api/instructor/status").then((st) => {
      if (st.awaitingPrefs) {
        awaiting = true;
        askBtn.textContent = "Sync mentor's answers";
        status.className = "slack-action-status";
        status.textContent = "Waiting on your mentor's Slack reply — click Sync when they answer.";
      }
    }).catch(() => {});
  }

  row.appendChild(status);
  wrap.appendChild(row);
  sec.appendChild(wrap);
}

// Push collected mentor preferences into the live form + draft + appConfig so
// the values show immediately and a later Save won't clobber them with stale text.
function applyPrefsToForm(inputs, draft, instructor) {
  if (!instructor) return;
  draft.instructor = Object.assign(draft.instructor || {}, instructor);
  appConfig = appConfig || {};
  appConfig.instructor = Object.assign(appConfig.instructor || {}, instructor);
  for (const [k, meta] of Object.entries(inputs)) {
    if (!(k in instructor)) continue;
    const v = instructor[k];
    meta.input.value = meta.isArray
      ? (Array.isArray(v) ? v.join("\n") : (v || ""))
      : (v == null ? "" : String(v));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// App bootstrap
// ─────────────────────────────────────────────────────────────────────────────

async function init() {
  register("#/checkin",  renderCheckin);
  register("#/history",  renderHistory);
  register("#/settings", renderSettings);
  register("#/onboard",  renderOnboard);

  const main = document.getElementById("main");
  main.appendChild(spinner("Starting…"));

  try {
    appConfig = await api("GET", "/api/config");
  } catch (e) {
    main.innerHTML = "";
    main.appendChild(errorBox(
      "Could not connect to the Builder Log server. Is the server running? (" + e.message + ")"));
    return;
  }

  buildNav(appConfig?.setupComplete);

  // Route to onboarding if setup not complete; otherwise honour the hash.
  if (!appConfig?.setupComplete) {
    window.location.hash = "#/onboard";
  } else if (!window.location.hash || window.location.hash === "#") {
    window.location.hash = "#/checkin";
  }

  handleRoute();
}

document.addEventListener("DOMContentLoaded", init);
