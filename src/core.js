/*
 * Builder Log Agent — Surface-agnostic engine (src/core.js).
 *
 * This module is the single source of truth for the ask→answer→sync pipeline.
 * It has NO knowledge of surfaces (no console.log, no Slack calls, no HTTP).
 * Web, CLI, and future surfaces all call these functions and handle I/O themselves.
 *
 * Public API:
 *   loadConfig()                           — read config.json or null
 *   loadState()                            — read state.json with safe fallback
 *   saveState(state)                       — write state.json atomically
 *   today()                                — "YYYY-MM-DD" in local time
 *   ensureDirs()                           — mkdir -p raw/{work,chat,instructor} log reports
 *
 *   async runAsk(cfg, state)               — observe + ask; writes raw/ files
 *     returns { changed, date, questions, questionList, files, delta }
 *
 *   async runSync(cfg, state, input)       — extract + apply + synthesize; writes log/
 *     input: { answersText } | { answers: [{question, answer}] }
 *     returns { date, entry, logPath, instructorDraft, gated,
 *               memory: { open, resolvedThisRun, blockers } }
 *
 *   statusView(cfg, state)                 — structured status object (no I/O)
 *     returns { builder, provider, lastRun,
 *               openCommitments, resolved, blockers, churn }
 *
 * Path resolution: ROOT = path.resolve(__dirname, "..") — all data files
 * (config.json, state.json, raw/, log/, reports/) resolve against ROOT, not src/.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const { snapshot, diff } = require("./observe");
const { complete } = require("./provider");
const { applyExtraction, bumpChurn, historyView } = require("./track");
const { THESIS, askQuestions, extractFacts, synthesizeEntry } = require("./templates/index");

// ---------------------------------------------------------------------------
// Path constants — everything relative to the repo root, not src/
// ---------------------------------------------------------------------------

const ROOT = path.resolve(__dirname, "..");
const CONFIG_PATH = path.join(ROOT, "config.json");
const STATE_PATH = path.join(ROOT, "state.json");

// Max chars of each changed file fed to the LLM (keeps prompts manageable).
const MAX_EXCERPT = 4000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Read a JSON file; return fallback if missing or unparseable. */
function readJson(p, fallback) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return fallback;
  }
}

/** Parse JSON out of an LLM reply that may include prose or a code fence. */
function parseJsonLoose(s) {
  let t = (s || "").trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(t);
  if (fence) t = fence[1].trim();
  const first = t.indexOf("{");
  const last = t.lastIndexOf("}");
  if (first !== -1 && last !== -1) t = t.slice(first, last + 1);
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}

/** Pull the "## For your instructor" section body from a synthesized entry. */
function extractInstructorSection(entry) {
  const m = /##\s*For your instructor\s*\n([\s\S]*?)(?=\n##\s|\s*$)/i.exec(entry);
  return m ? m[1].trim() : "";
}

/**
 * Read the content of every changed file (truncated to MAX_EXCERPT).
 * Returns { relPath: { change, excerpt, truncated } }.
 */
function gatherDelta(root, d) {
  const files = {};
  for (const rel of [...d.added, ...d.modified]) {
    let content = "";
    try {
      content = fs.readFileSync(path.join(root, rel), "utf8");
    } catch {
      content = "(could not read)";
    }
    files[rel] = {
      change: d.added.includes(rel) ? "new" : "modified",
      excerpt: content.slice(0, MAX_EXCERPT),
      truncated: content.length > MAX_EXCERPT,
    };
  }
  return files;
}

/**
 * Format the files object into a readable prompt section.
 * Returns a string ready to insert into the ask prompt.
 */
function deltaForPrompt(files) {
  if (Object.keys(files).length === 0) return "(no file changes detected)";
  return Object.entries(files)
    .map(
      ([rel, f]) =>
        `### ${rel} (${f.change})\n${f.excerpt}${f.truncated ? "\n…(truncated)" : ""}`
    )
    .join("\n\n");
}

/**
 * Rebuild the raw/chat markdown format from structured web answers.
 * answers: [{question: string, answer: string}]
 */
function buildChatFromAnswers(date, answers) {
  const header = `# Interview — ${date}\n\n`;
  const body = answers
    .map(
      ({ question, answer }) =>
        `**${question.trim()}**\n\n> _answer:_ ${(answer || "").trim()}\n`
    )
    .join("\n");
  return header + body;
}

/**
 * Build the historyContext string passed to synthesizeEntry.
 * Contains raw accumulated facts + instructor preferences (no pre-judgments).
 */
function buildHistoryContext(cfg, state, view, date) {
  const recentInstructor = (state.instructorThread || []).slice(-3);

  return (
    `HISTORY CONTEXT (raw accumulated facts — NOT pre-judged):\n` +
    `- Open commitments: ${
      view.openCommitments.length
        ? view.openCommitments
            .map(
              (c) =>
                `${c.id} "${c.text}" (opened ${c.openedOn}, ${c.daysOpen}d ago, carried ${c.carried}x, evidence: ${c.hasEvidence ? "yes" : "none"}${c.due ? `, due ${c.due}` : ""})`
            )
            .join("; ")
        : "none"
    }\n` +
    `- Blockers seen: ${
      view.blockers.length
        ? view.blockers
            .map((b) => `"${b.text}" (seen ${b.count}x, last ${b.lastSeen})`)
            .join("; ")
        : "none"
    }\n` +
    `- File churn: ${
      view.churn.length
        ? view.churn.map((c) => `${c.file} (${c.changes} changes)`).join("; ")
        : "none"
    }\n` +
    `Instructor cares about: ${(cfg.instructor?.caresAbout || []).join("; ") || "n/a"}. ` +
    `Wants flagged early: ${(cfg.instructor?.wantsFlaggedEarly || []).join("; ") || "n/a"}.` +
    `${
      (cfg.instructor?.preferencesSource || "default") === "default"
        ? " (NOTE: these are DEFAULT preferences — the actual instructor has not customized them yet.)"
        : ""
    }\n` +
    `Recent instructor messages: ${
      recentInstructor.length
        ? recentInstructor.map((m) => `"${m.text}"`).join("; ")
        : "none"
    }\n` +
    `Using this history together with the instructor's priorities and the builder's context, YOU decide ` +
    `what is significant — which commitments are stalling, which blockers are worth escalating, what to ` +
    `surface to the instructor. Do not apply fixed day thresholds; judge from the trajectory and what ` +
    `this instructor said they care about.`
  );
}

// ---------------------------------------------------------------------------
// Exported helpers
// ---------------------------------------------------------------------------

/** Load config.json; returns null if missing or invalid. */
function loadConfig() {
  return readJson(CONFIG_PATH, null);
}

/** Load state.json; returns a safe empty state if missing or invalid. */
function loadState() {
  return readJson(STATE_PATH, {
    lastRun: null,
    files: {},
    commitments: [],
    blockers: [],
    instructorThread: [],
  });
}

/** Write state.json with a trailing newline. */
function saveState(state) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + "\n");
}

/** Return today's date as "YYYY-MM-DD" in local time. */
function today() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Ensure all data directories exist under ROOT. */
function ensureDirs() {
  for (const d of ["raw/work", "raw/chat", "raw/instructor", "log", "reports"]) {
    fs.mkdirSync(path.join(ROOT, d), { recursive: true });
  }
}

// ---------------------------------------------------------------------------
// Core pipeline
// ---------------------------------------------------------------------------

/**
 * runAsk(cfg, state) -> Promise<AskResult>
 *
 * Phase 1: observe the work folder, compute the file delta, call the provider
 * to generate grounded interview questions, and persist the RAW files.
 *
 * Writes:
 *   raw/work/<date>.json   — work delta + file excerpts (verbatim)
 *   raw/chat/<date>.md     — questions with blank answer slots
 *
 * No console.log. No Slack. Returns structured data only.
 *
 * Returns:
 * {
 *   changed: boolean,          — false if no file changes detected
 *   date: string,
 *   questions: string|null,    — raw LLM output (numbered list)
 *   questionList: string[],    — individual question strings (with numbering)
 *   files: object,             — gatherDelta result { relPath: {change,excerpt,truncated} }
 *   delta: object,             — { isFirstRun, added, modified, deleted }
 * }
 */
async function runAsk(cfg, state) {
  const root = cfg.root;
  const curr = snapshot(root);
  const d = diff(state.files, curr);
  const date = today();
  const changed = [...d.added, ...d.modified];

  if (changed.length === 0 && d.deleted.length === 0) {
    return { changed: false, date, questions: null, questionList: [], files: {}, delta: d };
  }

  const files = gatherDelta(root, d);
  const deltaText = deltaForPrompt(files);

  const prompts = cfg.prompts || {};
  const prompt = askQuestions({
    thesis: prompts.thesis || THESIS,
    openCommitments: state.commitments || [],
    deltaText,
    deleted: d.deleted,
    guidance: prompts.askGuidance,
  });

  const questions = await complete(prompt, { provider: cfg.provider, config: cfg });

  // Parse into individual question strings (filter blank lines).
  const questionList = questions
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  // RAW: persist the work delta verbatim.
  fs.writeFileSync(
    path.join(ROOT, "raw", "work", `${date}.json`),
    JSON.stringify({ date, root, ...d, files }, null, 2) + "\n"
  );

  // RAW: open the chat transcript with the questions + blank answer slots.
  const chatPath = path.join(ROOT, "raw", "chat", `${date}.md`);
  const qLines = questionList
    .map((q) => `**${q}**\n\n> _answer:_ \n`)
    .join("\n");
  fs.writeFileSync(chatPath, `# Interview — ${date}\n\n${qLines}`);

  return { changed: true, date, questions, questionList, files, delta: d };
}

/**
 * runSync(cfg, state, input) -> Promise<SyncResult>
 *
 * Phase 2: read the builder's answers (from file or structured web input),
 * extract structured facts (Step A), update memory (Step B), synthesize
 * the Builder Log entry (Step C), and persist everything.
 *
 * input:
 *   { answersText: string }                  — raw content of raw/chat/<date>.md
 *   { answers: [{question, answer}] }        — structured answers from web UI
 *
 * Writes:
 *   raw/chat/<date>.md         — updated with answers (idempotent if answersText)
 *   raw/instructor/<date>.md  — appended with instructor draft if non-trivial
 *   log/<date>.md             — DERIVED: the final Builder Log entry
 *   state.json                — updated commitments, blockers, churn, snapshot
 *
 * No console.log. No Slack. Returns structured data only.
 *
 * Returns:
 * {
 *   date: string,
 *   entry: string,             — full markdown log entry text
 *   logPath: string,           — absolute path to log/<date>.md
 *   instructorDraft: string,   — "For your instructor" body (empty if nothing to flag)
 *   gated: boolean,            — true = instructor note needs manual review before send
 *   memory: {
 *     open: number,            — open commitment count after this run
 *     resolvedThisRun: number, — commitments resolved in this run
 *     blockers: number,        — total blocker count
 *   },
 * }
 */
async function runSync(cfg, state, input) {
  const date = today();
  const chatPath = path.join(ROOT, "raw", "chat", `${date}.md`);
  const workPath = path.join(ROOT, "raw", "work", `${date}.json`);

  // Resolve chat content and persist to raw/chat if needed.
  let chat;
  if (input && input.answers) {
    // Structured answers from web UI — rebuild to raw/chat markdown format.
    chat = buildChatFromAnswers(date, input.answers);
    fs.writeFileSync(chatPath, chat);
  } else if (input && input.answersText != null) {
    // Raw file content from CLI (user edited the file directly).
    chat = input.answersText;
    // Write it back so the file is always the canonical source of truth.
    fs.writeFileSync(chatPath, chat);
  } else {
    // Fallback: read the file if it exists; caller should have provided input.
    if (!fs.existsSync(chatPath)) {
      throw new Error(`No interview for ${date}. Run ask first.`);
    }
    chat = fs.readFileSync(chatPath, "utf8");
  }

  const work = readJson(workPath, {});
  const changedFiles = Object.keys(work.files || {});
  const openBefore = (state.commitments || []).filter((c) => c.status === "open");

  // --- Step A: extract structured facts (memory update) ---
  const prompts = cfg.prompts || {};
  const exPrompt = extractFacts({
    thesis: prompts.thesis || THESIS,
    date,
    openCommitments: openBefore,
    chat,
    changedFiles,
  });

  const extraction =
    parseJsonLoose(await complete(exPrompt, { provider: cfg.provider, config: cfg })) || {};

  // --- Step B: apply extraction + bump churn ---
  applyExtraction(state, extraction, date);
  bumpChurn(state, changedFiles);
  const view = historyView(state, date);

  // --- Step C: synthesize the entry ---
  const historyContext = buildHistoryContext(cfg, state, view, date);

  const synthPrompt = synthesizeEntry({
    thesis: prompts.thesis || THESIS,
    historyContext,
    work,
    chat,
    extraGuidance: prompts.synthesisGuidance,
  });

  const entry = await complete(synthPrompt, { provider: cfg.provider, config: cfg });

  // Write the derived log entry with a header.
  const header =
    `# Builder Log — ${date}\n\n` +
    `_Builder: ${cfg.builder?.name || "?"} · Project: ${cfg.builder?.project || "?"}_\n` +
    `_Files changed: ${changedFiles.join(", ") || "none"}_\n\n`;

  const logPath = path.join(ROOT, "log", `${date}.md`);
  fs.writeFileSync(logPath, header + entry + "\n");

  // Instructor triage: always persist draft; surfaces decide whether/when to send.
  const instructorDraft = extractInstructorSection(entry);
  const gated = cfg.slack?.gateInstructorMessages !== false; // default: true (gated)

  if (instructorDraft && !/nothing needs instructor input/i.test(instructorDraft)) {
    fs.appendFileSync(
      path.join(ROOT, "raw", "instructor", `${date}.md`),
      `\n## Draft for instructor (outbound) — ${date}\n${instructorDraft}\n`
    );
    // Store for Slack surface's pending-send flow.
    state.slack = state.slack || {};
    state.slack.pendingInstructor = { date, text: instructorDraft };
  }

  // Commit the file snapshot so the next run only sees genuinely new changes.
  state.files = snapshot(cfg.root);
  state.lastRun = new Date().toISOString();
  // Clean up legacy orphaned flags from older state shapes.
  delete state.lastFlags;
  saveState(state);

  const resolvedThisRun = (extraction.resolved || []).length;
  const openCount = (state.commitments || []).filter((c) => c.status === "open").length;

  return {
    date,
    entry,
    logPath,
    instructorDraft: instructorDraft || "",
    gated,
    memory: {
      open: openCount,
      resolvedThisRun,
      blockers: (state.blockers || []).length,
    },
  };
}

/**
 * statusView(cfg, state) -> StatusResult
 *
 * Returns a structured object representing the current memory state.
 * Pure — no I/O, no LLM calls.
 *
 * Returns:
 * {
 *   builder: string,
 *   provider: string,
 *   lastRun: string|null,
 *   openCommitments: [{id, text, openedOn, daysOpen, carried, due, hasEvidence}],
 *   resolved: [{id, text, resolvedOn, evidence}],
 *   blockers: [{text, count, firstSeen, lastSeen}],
 *   churn: [{file, changes}],
 * }
 */
function statusView(cfg, state) {
  const date = today();
  const view = historyView(state, date);
  const resolved = (state.commitments || []).filter((c) => c.status === "done");

  return {
    builder: cfg?.builder?.name || "?",
    provider: cfg?.provider || "claude-p",
    lastRun: state.lastRun || null,
    openCommitments: view.openCommitments,
    resolved: resolved.map((c) => ({
      id: c.id,
      text: c.text,
      resolvedOn: c.resolvedOn,
      evidence: c.evidence,
    })),
    blockers: view.blockers,
    churn: view.churn,
  };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  // Data helpers
  loadConfig,
  loadState,
  saveState,
  today,
  ensureDirs,
  // Pipeline
  runAsk,
  runSync,
  // Read-only
  statusView,
  // Expose ROOT for surfaces that need to build relative paths for display
  ROOT,
};
