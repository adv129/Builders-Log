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

function buildNav(setupComplete) {
  const nav = document.getElementById("nav");
  nav.innerHTML = "";

  const brand = el("span", "nav-brand", "Builder Log");
  nav.appendChild(brand);

  const links = setupComplete
    ? [["#/checkin", "Check-in"], ["#/history", "History"], ["#/settings", "Settings"]]
    : [["#/settings", "Settings"]];

  links.forEach(([hash, label]) => {
    const a = document.createElement("a");
    a.href = hash;
    a.textContent = label;
    a.className = "nav-link";
    a.setAttribute("data-route", hash);
    nav.appendChild(a);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// SCREEN 1 — Check-in (#/checkin)
// ─────────────────────────────────────────────────────────────────────────────

function renderCheckin(container) {
  // Local state machine
  const s = {
    phase: "idle",   // idle | asking | questions | generating | done
    date: null,
    askResult: null,
    syncResult: null,
    pendingAnswers: null,  // string[] parallel to questionList
    error: null,
  };

  function draw() {
    container.innerHTML = "";
    const screen = el("div", "screen checkin-screen");

    screen.appendChild(el("h1", null, "Daily Check-in"));

    if (s.phase === "idle") {
      screen.appendChild(el("p", "screen-desc", "Record what you built, decided, or learned today."));
      if (s.error) screen.appendChild(errorBox(s.error));
      const btn = el("button", "btn-primary", "Start check-in");
      btn.addEventListener("click", doAsk);
      screen.appendChild(btn);
    }

    if (s.phase === "asking") {
      screen.appendChild(spinner("Analyzing your recent work — this takes about 15 seconds…"));
    }

    if (s.phase === "questions") {
      const result = s.askResult;

      if (!result || !result.changed) {
        const empty = el("div", "empty-state");
        empty.appendChild(el("p", null, "No new work since your last check-in."));
        empty.appendChild(el("p", "muted", "Edit something in your project folder and try again."));
        screen.appendChild(empty);
        const btn = el("button", "btn-secondary", "Try again");
        btn.addEventListener("click", doAsk);
        screen.appendChild(btn);
      } else {
        const qs = result.questionList || [];
        screen.appendChild(el("p", "screen-desc",
          `Answer these questions about your work, then click "Generate entry" to create your log.`));

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

      // Instructor draft
      if (r.instructorDraft) {
        const draftWrap = el("div", "draft-wrap");
        const labelEl = el("div", "section-label");
        labelEl.appendChild(document.createTextNode("Instructor note "));
        if (r.gated) {
          labelEl.appendChild(el("span", "badge-gated", "draft — not sent"));
        } else {
          labelEl.appendChild(el("span", "badge-sent", "sent"));
        }
        draftWrap.appendChild(labelEl);
        const draftBody = el("div", "markdown-body");
        draftBody.innerHTML = renderMarkdown(r.instructorDraft || "");
        draftWrap.appendChild(draftBody);
        screen.appendChild(draftWrap);

        // Slack delivery button — only shown when chatSurface is "slack" and the
        // note is gated (needs manual approval before sending).
        if (r.gated && appConfig && appConfig.chatSurface === "slack") {
          const actionRow = el("div", "slack-action-row");
          const sendBtn = el("button", "btn-secondary", "Send note to instructor via Slack");
          const statusEl = el("span", "slack-action-status", "");
          sendBtn.addEventListener("click", async () => {
            sendBtn.disabled = true;
            statusEl.className = "slack-action-status";
            statusEl.textContent = "Sending…";
            try {
              const result = await api("POST", "/api/send-instructor", { date: r.date });
              if (result.ok) {
                statusEl.className = "slack-action-status success";
                statusEl.textContent = "Sent to instructor.";
              } else {
                statusEl.className = "slack-action-status warn";
                statusEl.textContent = result.reason || "Nothing to send.";
                sendBtn.disabled = false;
              }
            } catch (e) {
              statusEl.className = "slack-action-status error";
              statusEl.textContent = "Failed: " + e.message;
              sendBtn.disabled = false;
            }
          });
          actionRow.appendChild(sendBtn);
          actionRow.appendChild(statusEl);
          screen.appendChild(actionRow);
        }
      }

      const btn = el("button", "btn-secondary", "Start new check-in");
      btn.style.marginTop = "0.5rem";
      btn.addEventListener("click", () => {
        s.phase = "idle"; s.date = null; s.askResult = null;
        s.syncResult = null; s.pendingAnswers = null; s.error = null;
        draw();
      });
      screen.appendChild(btn);
    }

    container.appendChild(screen);
  }

  async function doAsk() {
    s.phase = "asking"; s.error = null;
    draw();
    try {
      const result = await api("POST", "/api/ask");
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

  draw();
}

// ─────────────────────────────────────────────────────────────────────────────
// SCREEN 2 — History & status (#/history)
// ─────────────────────────────────────────────────────────────────────────────

function renderHistory(container) {
  container.innerHTML = "";
  const screen = el("div", "screen history-screen");
  screen.appendChild(el("h1", null, "History & Status"));

  const layout = el("div", "history-layout");

  // Status panel
  const statusPanel = el("div", "status-panel");
  statusPanel.appendChild(spinner("Loading status…"));
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

  // Fetch both in parallel
  Promise.all([api("GET", "/api/status"), api("GET", "/api/logs")])
    .then(([status, logs]) => {
      statusPanel.innerHTML = "";
      drawStatusPanel(statusPanel, status);

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
    .catch((e) => {
      statusPanel.innerHTML = "";
      statusPanel.appendChild(errorBox("Failed to load status: " + e.message));
    });

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

function drawStatusPanel(container, status) {
  const commitments = status.openCommitments || [];
  const resolved    = status.resolved || [];
  const blockers    = status.blockers || [];
  const churn       = status.churn || [];

  // Stat row
  const hdr = el("div", "status-header");
  [
    [commitments.length, "open"],
    [resolved.length, "resolved"],
    [blockers.length, "blockers"],
  ].forEach(([n, label]) => {
    const stat = el("div", "status-stat");
    stat.appendChild(el("span", "stat-n", String(n)));
    stat.appendChild(el("span", "stat-label", label));
    hdr.appendChild(stat);
  });
  container.appendChild(hdr);

  if (commitments.length) {
    const sec = el("div", "status-section");
    sec.appendChild(el("h3", null, "Open commitments"));
    commitments.forEach((c) => {
      const item = el("div", "commitment-item");
      item.appendChild(el("p", "commitment-text", esc(c.text)));
      const age      = `${c.daysOpen} day${c.daysOpen !== 1 ? "s" : ""}`;
      const carried  = c.carried ? ` · carried ${c.carried}x` : "";
      const evidence = c.hasEvidence ? " · has evidence" : " · no evidence yet";
      const due      = c.due ? ` · due ${esc(c.due)}` : "";
      item.appendChild(el("p", "commitment-meta", `${age}${carried}${evidence}${due}`));
      sec.appendChild(item);
    });
    container.appendChild(sec);
  }

  if (blockers.length) {
    const sec = el("div", "status-section");
    sec.appendChild(el("h3", null, "Blockers"));
    blockers.forEach((b) => {
      const item = el("div", "blocker-item");
      item.appendChild(el("p", "blocker-text", esc(b.text)));
      item.appendChild(el("p", "muted",
        `Seen ${b.count} time${b.count !== 1 ? "s" : ""} · first seen ${esc(b.firstSeen)}`));
      sec.appendChild(item);
    });
    container.appendChild(sec);
  }

  if (churn.length) {
    const sec = el("div", "status-section");
    sec.appendChild(el("h3", null, "Active files"));
    const table = el("div", "churn-table");
    churn.slice(0, 12).forEach(({ file, changes }) => {
      const row = el("div", "churn-row");
      row.appendChild(el("span", "churn-file", esc(file)));
      row.appendChild(el("span", "churn-count", String(changes)));
      table.appendChild(row);
    });
    sec.appendChild(table);
    container.appendChild(sec);
  }

  if (!commitments.length && !blockers.length && !churn.length) {
    container.appendChild(el("p", "muted",
      "No active commitments, blockers, or file activity yet."));
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

  const STEPS = ["Provider", "Watch folder", "Builder info", "Instructor", "Review & save"];

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

        buildNav(true);
        navigate("#/checkin");
        handleRoute();
      } catch (e) {
        errBox.appendChild(errorBox("Save failed: " + e.message));
        save.disabled = false;
        save.textContent = "Save and start";
      }
    });
    navRow.appendChild(save);
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

  Promise.all([api("GET", "/api/config"), api("GET", "/api/providers")])
    .then(([cfg, providers]) => {
      screen.innerHTML = "";
      screen.appendChild(el("h1", null, "Settings"));
      renderSettingsForm(screen, cfg, providers);
    })
    .catch((e) => {
      screen.innerHTML = "";
      screen.appendChild(el("h1", null, "Settings"));
      screen.appendChild(errorBox("Failed to load settings: " + e.message));
    });
}

function renderSettingsForm(container, cfg, providers) {
  // Deep clone so edits don't mutate the original
  let draft = JSON.parse(JSON.stringify(cfg));

  function section(title) {
    const sec = el("div", "settings-section");
    sec.appendChild(el("h2", null, esc(title)));
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

  // ── Watch folder ──
  const folderSec = section("Watch folder");
  const folderDisplay = el("div", "folder-selected" + (draft.root ? " active" : ""),
    draft.root ? "Current: " + esc(draft.root) : "(not set)");
  folderSec.appendChild(folderDisplay);

  let pickerShown = false;
  const pickerWrap = el("div");
  pickerWrap.style.display = "none";

  const toggleBtn = el("button", "btn-ghost", "Change folder");
  toggleBtn.addEventListener("click", () => {
    pickerShown = !pickerShown;
    pickerWrap.style.display = pickerShown ? "block" : "none";
    if (pickerShown && !pickerWrap.children.length) {
      renderFolderPicker(pickerWrap, draft.root, (p) => {
        draft.root = p;
        folderDisplay.textContent = "Current: " + p;
        folderDisplay.classList.add("active");
      });
    }
    toggleBtn.textContent = pickerShown ? "Hide folder picker" : "Change folder";
  });
  folderSec.appendChild(toggleBtn);
  folderSec.appendChild(pickerWrap);
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

  const instrNameF = makeField("Instructor name", draft.instructor?.name, { placeholder: "e.g. Dr. Smith" });
  instrNameF.input.addEventListener("input", () => {
    if (!draft.instructor) draft.instructor = {};
    draft.instructor.name = instrNameF.input.value;
  });
  instrSec.appendChild(instrNameF.grp);

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
  });
  container.appendChild(instrSec);

  // ── Slack ──
  const slackSec = section("Slack (optional)");
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

  // ── Slack actions (only shown when chatSurface is already "slack") ──
  // Renders based on the saved cfg, not the draft being edited, so the
  // builder must save their Slack settings before these buttons appear.
  if (cfg.chatSurface === "slack") {
    const slackActSec = section("Slack actions");
    slackActSec.appendChild(el("p", "muted",
      "Manually trigger Slack messages. These use your saved settings above."));

    const reminderRow = el("div", "slack-action-row");
    const reminderBtn = el("button", "btn-secondary", "Send me a check-in reminder");
    const reminderStatus = el("span", "slack-action-status", "");
    reminderBtn.addEventListener("click", async () => {
      reminderBtn.disabled = true;
      reminderStatus.className = "slack-action-status";
      reminderStatus.textContent = "Sending…";
      try {
        await api("POST", "/api/reminder");
        reminderStatus.className = "slack-action-status success";
        reminderStatus.textContent = "Reminder sent — check Slack.";
      } catch (e) {
        reminderStatus.className = "slack-action-status error";
        reminderStatus.textContent = "Failed: " + e.message;
        reminderBtn.disabled = false;
      }
    });
    reminderRow.appendChild(reminderBtn);
    reminderRow.appendChild(reminderStatus);
    slackActSec.appendChild(reminderRow);

    container.appendChild(slackActSec);
  }

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
