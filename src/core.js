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

const { snapshot, diff, parseKey, isIgnoredRel } = require("./observe");
const { complete } = require("./provider");
const { bumpChurn, historyView } = require("./track");
const { THESIS, askQuestions, extractFacts, synthesizeEntry, projectPlanPrompt, suggestObjectives,
  extractInstructorPrefs, INSTRUCTOR_QUESTIONS } = require("./templates/index");
const plan = require("./plan");

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
 * rootsOf(cfg) -> [{ id, type, path, label, summary }]
 *
 * The tracked-roots registry. Falls back to the legacy single `cfg.root` so
 * older configs keep working until they're migrated on the next save.
 */
function rootsOf(cfg) {
  if (cfg && Array.isArray(cfg.roots) && cfg.roots.length) return cfg.roots;
  if (cfg && cfg.root) {
    return [{ id: "r1", type: "local", path: cfg.root, label: path.basename(cfg.root), summary: "" }];
  }
  return [];
}

/**
 * isInsideRoots(absPath, cfg) -> boolean
 *
 * True if absPath resolves inside any registered work root. Used to enforce the
 * read-only-after-onboarding rule: normal operation must never write into work
 * dirs (only the onboarding scaffold step is exempt, and calls fs directly).
 */
function isInsideRoots(absPath, cfg) {
  const p = path.resolve(absPath);
  return rootsOf(cfg).some((r) => {
    if (!r.path) return false;
    const base = path.resolve(r.path);
    return p === base || p.startsWith(base + path.sep);
  });
}

/**
 * Read the content of every changed file (truncated to MAX_EXCERPT).
 * `cfg` carries the roots registry so namespaced keys (`<rootId>/<rel>`) resolve
 * to the right absolute path. Returns { displayPath: { change, excerpt,
 * truncated, root, rel } }, displayPath being "<rootLabel>/<rel>".
 */
function gatherDelta(cfg, d) {
  const roots = rootsOf(cfg);
  const byId = Object.fromEntries(roots.map((r) => [r.id, r]));
  const files = {};
  for (const key of [...d.added, ...d.modified]) {
    const { rootId, rel } = parseKey(key);
    const root = byId[rootId] || roots[0] || null;
    const abs = root ? path.join(root.path, rel) : rel;
    let content = "";
    try {
      content = fs.readFileSync(abs, "utf8");
    } catch {
      content = "(could not read)";
    }
    const display = root && root.label ? `${root.label}/${rel}` : key;
    files[display] = {
      change: d.added.includes(key) ? "new" : "modified",
      excerpt: content.slice(0, MAX_EXCERPT),
      truncated: content.length > MAX_EXCERPT,
      root: rootId,
      rel,
    };
  }
  return files;
}

/**
 * Summarize a list of changed-file display paths for the log header. Caps the
 * list so the header stays signal — a wall of 30+ paths (test files, configs,
 * assets) buries what actually changed.
 */
function summarizeChangedFiles(files, max = 8) {
  if (!files.length) return "none";
  if (files.length <= max) return files.join(", ");
  return `${files.slice(0, max).join(", ")}, +${files.length - max} more (${files.length} total)`;
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
function buildHistoryContext(cfg, state, week, date) {
  const recentInstructor = (state.instructorThread || []).slice(-3);
  const objLine = (week.objectives || [])
    .map((o) => `${o.done ? "[done] " : "[ ] "}"${o.text}"`)
    .join("; ");
  const blkLine = (week.blockers || [])
    .map((b) => `"${b.text}" (seen ${b.count}x${b.since ? `, since ${b.since}` : ""})`)
    .join("; ");
  const progLine = (week.progress || []).slice(-8).map((p) => `"${p}"`).join("; ");

  return (
    `WEEK CONTEXT (this week's plan — NOT pre-judged):\n` +
    `- Objectives: ${objLine || "none set"}\n` +
    `- Recent progress: ${progLine || "none"}\n` +
    `- Blockers: ${blkLine || "none"}\n` +
    `- Where to look: ${(week.whereToLook || []).join("; ") || "n/a"}\n` +
    `Instructor cares about: ${(cfg.instructor?.caresAbout || []).join("; ") || "n/a"}. ` +
    `Wants flagged early: ${(cfg.instructor?.wantsFlaggedEarly || []).join("; ") || "n/a"}.` +
    `${
      (cfg.instructor?.preferencesSource || "default") !== "instructor"
        ? " (NOTE: these preferences are NOT mentor-calibrated — they are defaults or the builder's own guess, " +
          "not set by the actual instructor. Weight them accordingly.)"
        : ""
    }\n` +
    `Recent instructor messages: ${
      recentInstructor.length
        ? recentInstructor.map((m) => `"${m.text}"`).join("; ")
        : "none"
    }\n` +
    `Using this week's objectives together with the builder's progress and what this instructor said ` +
    `they care about, YOU decide what is significant — which objectives are stalling, which blockers ` +
    `are worth escalating, what to surface to the instructor. Do not apply fixed day thresholds; judge ` +
    `from the trajectory.`
  );
}

// ---------------------------------------------------------------------------
// Exported helpers
// ---------------------------------------------------------------------------

/** Load config.json; returns null if missing or invalid. */
function loadConfig() {
  const cfg = readJson(CONFIG_PATH, null);
  return cfg ? migrateConfig(cfg) : null;
}

/**
 * In-memory migration: ensure the roots registry exists and is well-formed.
 * Non-destructive — does not rewrite config.json; the next save persists it.
 * Legacy single `cfg.root` becomes roots[0]; `cfg.root` is kept in sync so old
 * readers (CLI validate, server REQUIRED check) keep working.
 */
function migrateConfig(cfg) {
  let roots = Array.isArray(cfg.roots) ? cfg.roots : [];
  if (!roots.length && cfg.root) {
    roots = [{ id: "r1", type: "local", path: cfg.root }];
  }
  cfg.roots = roots.map((r, i) => ({
    id: r.id || `r${i + 1}`,
    type: r.type || "local",
    path: r.path,
    label: r.label || (r.path ? path.basename(r.path) : `root ${i + 1}`),
    summary: r.summary || "",
  }));
  if (!cfg.root && cfg.roots[0]) cfg.root = cfg.roots[0].path;
  return cfg;
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
  for (const d of ["raw/work", "raw/chat", "raw/instructor", "log", "reports", "plan"]) {
    fs.mkdirSync(path.join(ROOT, d), { recursive: true });
  }
}

// ---------------------------------------------------------------------------
// Core pipeline
// ---------------------------------------------------------------------------

/**
 * runAsk(cfg, state, opts) -> Promise<AskResult>
 *
 * Phase 1: observe the work folder, compute the file delta, call the provider
 * to generate grounded interview questions, and persist the RAW files.
 *
 * opts.allowEmpty (default false): when there is no file delta, proceed anyway
 * with a "reflection" check-in (questions about meetings/decisions/being stuck)
 * instead of short-circuiting to { changed: false }.
 *
 * Writes:
 *   raw/work/<date>.json   — work delta + file excerpts (verbatim)
 *   raw/chat/<date>.md     — questions with blank answer slots
 *
 * No console.log. No Slack. Returns structured data only.
 *
 * Returns:
 * {
 *   changed: boolean,          — false if no file changes detected (and not allowEmpty)
 *   reflective: boolean,       — true when this is a no-delta reflection check-in
 *   date: string,
 *   questions: string|null,    — raw LLM output (numbered list)
 *   questionList: string[],    — individual question strings (with numbering)
 *   files: object,             — gatherDelta result { relPath: {change,excerpt,truncated} }
 *   delta: object,             — { isFirstRun, added, modified, deleted }
 * }
 */
async function runAsk(cfg, state, opts = {}) {
  const curr = snapshot(rootsOf(cfg));
  const d = diff(state.files, curr);
  // Drop phantom deletions of files we now ignore — an older snapshot may still
  // list noise/build files that snapshot() no longer tracks. Real deletions stay.
  d.deleted = d.deleted.filter((key) => !isIgnoredRel(parseKey(key).rel));
  const date = today();
  const changed = [...d.added, ...d.modified];
  const hasDelta = changed.length > 0 || d.deleted.length > 0;

  // No file changes: dead-end as before UNLESS the caller opted into a
  // reflection check-in (opts.allowEmpty) — a lot of real build progress is a
  // meeting, a decision, or time spent stuck, none of which moves a file.
  if (!hasDelta && !opts.allowEmpty) {
    return { changed: false, reflective: false, date, questions: null, questionList: [], files: {}, delta: d };
  }

  const reflective = !hasDelta;
  const files = reflective ? {} : gatherDelta(cfg, d);
  const deltaText = reflective ? "(no file changes this session)" : deltaForPrompt(files);

  const week = plan.weeklyView(plan.readWeeklyPlan(plan.mondayOf(date)));
  const prompts = cfg.prompts || {};
  const prompt = askQuestions({
    thesis: prompts.thesis || THESIS,
    objectives: week.objectives,
    blockers: week.blockers,
    deltaText,
    deleted: d.deleted,
    guidance: prompts.askGuidance,
    reflective,
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
    JSON.stringify({ date, roots: rootsOf(cfg).map((r) => r.path), ...d, files }, null, 2) + "\n"
  );

  // RAW: open the chat transcript with the questions + blank answer slots.
  const chatPath = path.join(ROOT, "raw", "chat", `${date}.md`);
  const qLines = questionList
    .map((q) => `**${q}**\n\n> _answer:_ \n`)
    .join("\n");
  fs.writeFileSync(chatPath, `# Interview — ${date}\n\n${qLines}`);

  return { changed: true, reflective, date, questions, questionList, files, delta: d };
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
  const weekOf = plan.mondayOf(date);
  const weekBefore = plan.weeklyView(plan.readWeeklyPlan(weekOf));

  // --- Step A: extract structured facts against this week's objectives ---
  const prompts = cfg.prompts || {};
  const exPrompt = extractFacts({
    thesis: prompts.thesis || THESIS,
    date,
    objectives: weekBefore.objectives,
    chat,
    changedFiles,
  });

  const extraction =
    parseJsonLoose(await complete(exPrompt, { provider: cfg.provider, config: cfg })) || {};

  // --- Step B: merge facts into the weekly plan (markdown-first source of truth) ---
  bumpChurn(state, changedFiles);
  plan.mergeIntoWeeklyPlan(weekOf, {
    date,
    progress: extraction.progress || [],
    checkObjectives: extraction.resolvedObjectives || [],
    blockers: extraction.blockers || [],
    dailySummary: extraction.summary ? { date, text: extraction.summary } : null,
  });
  const week = plan.weeklyView(plan.readWeeklyPlan(weekOf));

  // --- Step C: synthesize the entry ---
  const historyContext = buildHistoryContext(cfg, state, week, date);

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
    `_Files changed: ${summarizeChangedFiles(changedFiles)}_\n\n`;

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
  state.files = snapshot(rootsOf(cfg));
  state.lastRun = new Date().toISOString();
  // Clean up legacy orphaned flags from older state shapes.
  delete state.lastFlags;
  saveState(state);

  const resolvedThisRun = (extraction.resolvedObjectives || []).length;
  const openCount = (week.objectives || []).filter((o) => !o.done).length;

  return {
    date,
    weekOf,
    entry,
    logPath,
    instructorDraft: instructorDraft || "",
    gated,
    memory: {
      open: openCount,
      resolvedThisRun,
      blockers: (week.blockers || []).length,
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
// Project plan (high-level, weekly-refresh) + onboarding helpers
// ---------------------------------------------------------------------------

/**
 * buildProjectPlanPrompt(cfg, { mode }) -> string
 * The canonical prompt that (re)generates plan/project.md. Returned verbatim to
 * the UI for the "Copy prompt" button, and used by generateProjectPlan().
 */
function buildProjectPlanPrompt(cfg, opts = {}) {
  const dirs = rootsOf(cfg).map((r) => ({ path: r.path, label: r.label }));
  return projectPlanPrompt({ cfg, dirs, mode: opts.mode });
}

/**
 * runSuggestObjectives(cfg) -> Promise<string[]>
 * Ask the provider for a short (≤3) high-level objective shortlist for this week,
 * grounded in the project plan + recent progress/blockers. Does not write state.
 */
async function runSuggestObjectives(cfg) {
  const weekOf = plan.mondayOf(today());
  const week = plan.weeklyView(plan.readWeeklyPlan(weekOf));
  const prompt = suggestObjectives({
    thesis: (cfg.prompts && cfg.prompts.thesis) || THESIS,
    projectPlan: plan.readProjectPlan(),
    recentProgress: (week.progress || []).slice(-8),
    blockers: (week.blockers || []).map((b) => b.text),
  });
  const out = parseJsonLoose(await complete(prompt, { provider: cfg.provider, config: cfg })) || {};
  return Array.isArray(out.objectives) ? out.objectives.slice(0, 3) : [];
}

/**
 * runExtractInstructorPrefs(cfg, replyText) -> Promise<prefs>
 * Map an instructor's free-text calibration reply into structured preference
 * fields. Normalizes types (arrays vs strings). Returns empty fields on a parse
 * miss rather than throwing, so the caller can decide what to persist.
 */
async function runExtractInstructorPrefs(cfg, replyText) {
  const prompt = extractInstructorPrefs({
    thesis: (cfg.prompts && cfg.prompts.thesis) || THESIS,
    questions: INSTRUCTOR_QUESTIONS,
    reply: replyText,
  });
  const out = parseJsonLoose(await complete(prompt, { provider: cfg.provider, config: cfg })) || {};
  const arr = (v) => (Array.isArray(v) ? v.filter(Boolean).map(String) : (v ? [String(v)] : []));
  const str = (v) => (typeof v === "string" ? v.trim() : v == null ? "" : String(v));
  return {
    caresAbout: arr(out.caresAbout),
    wantsFlaggedEarly: arr(out.wantsFlaggedEarly),
    cadence: str(out.cadence),
    format: str(out.format),
    notUseful: str(out.notUseful),
    currentGoal: str(out.currentGoal),
  };
}

/** Generate plan/project.md via the provider and write it. Returns the text. */
async function generateProjectPlan(cfg, opts = {}) {
  const prompt = buildProjectPlanPrompt(cfg, opts);
  const text = await complete(prompt, { provider: cfg.provider, config: cfg });
  plan.writeProjectPlan(text);
  return text;
}

/**
 * scaffoldDirs(basePath, names) -> string[] (created absolute paths)
 *
 * THE ONE sanctioned write into work space (greenfield onboarding only). Creates
 * the proposed folder layout under basePath. Normal operation never writes into
 * roots — see isInsideRoots().
 */
function scaffoldDirs(basePath, names) {
  const created = [];
  for (const n of names || []) {
    const safe = String(n).replace(/[^\w\-./ ]/g, "").replace(/\.{2,}/g, ".").replace(/^\/+/, "");
    if (!safe) continue;
    const abs = path.join(basePath, safe);
    fs.mkdirSync(abs, { recursive: true });
    created.push(abs);
  }
  return created;
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
  // Roots registry
  rootsOf,
  isInsideRoots,
  // Pipeline
  runAsk,
  runSync,
  // Project plan + onboarding
  buildProjectPlanPrompt,
  generateProjectPlan,
  scaffoldDirs,
  // Weekly objectives
  runSuggestObjectives,
  // Mentor calibration
  runExtractInstructorPrefs,
  // Plan-file layer (re-exported for surfaces)
  plan,
  // Read-only
  statusView,
  // Expose ROOT for surfaces that need to build relative paths for display
  ROOT,
};
