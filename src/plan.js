/*
 * Builder Log Agent — Plan-file layer (src/plan.js).
 *
 * The layered, markdown-first source of truth:
 *   plan/project.md          high-level project plan (slow-changing, weekly refresh)
 *   plan/week-<weekOf>.md    the weekly plan — objectives / progress / blockers /
 *                            where-to-look / daily-log index
 *
 * These files are AGENT-MAINTAINED and HUMAN-EDITABLE. To survive hand edits,
 * the parser is section-tolerant: it splits on `## ` headings, only ever touches
 * the canonical sections, and preserves the title, preamble, and any unknown
 * sections verbatim on rewrite.
 *
 * Pure functions (parse/render/merge structures) are separated from the thin I/O
 * wrappers so they can be unit-tested without disk. All writes are confined to
 * the agent's own `plan/` dir under ROOT (never inside a tracked work root).
 */

"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const PLAN_DIR = path.join(ROOT, "plan");
const PROJECT_PATH = path.join(PLAN_DIR, "project.md");

// Canonical weekly-plan section headings, in render order.
const SECTIONS = ["Objectives", "Progress", "Blockers", "Where to look", "Daily log"];

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

/** Monday (YYYY-MM-DD) of the ISO-ish week containing dateStr (Mon-start). */
function mondayOf(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  const dow = (d.getDay() + 6) % 7; // 0 = Monday … 6 = Sunday
  d.setDate(d.getDate() - dow);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function weeklyPlanPath(weekOf) {
  return path.join(PLAN_DIR, `week-${weekOf}.md`);
}

// ---------------------------------------------------------------------------
// Section-tolerant markdown parse / render (pure)
// ---------------------------------------------------------------------------

/**
 * splitSections(md) -> { title, preamble: string[], sections: [{heading, body: string[]}] }
 * Everything before the first `## ` (after an optional leading `# title`) is
 * preamble. Unknown sections are kept so hand edits round-trip losslessly.
 */
function splitSections(md) {
  const lines = String(md || "").split("\n");
  let title = "";
  const preamble = [];
  const sections = [];
  let cur = null;
  let sawTitle = false;
  for (const line of lines) {
    const h2 = /^##\s+(.*)$/.exec(line);
    if (h2) {
      cur = { heading: h2[1].trim(), body: [] };
      sections.push(cur);
      continue;
    }
    const h1 = /^#\s+(.*)$/.exec(line);
    if (h1 && !sawTitle && !sections.length) {
      title = h1[1].trim();
      sawTitle = true;
      continue;
    }
    if (cur) cur.body.push(line);
    else preamble.push(line);
  }
  return { title, preamble, sections };
}

/** Inverse of splitSections. Normalizes to one blank line between blocks. */
function joinSections(p) {
  const blocks = [];
  if (p.title) blocks.push(`# ${p.title}`);
  const pre = (p.preamble || []).join("\n").trim();
  if (pre) blocks.push(pre);
  for (const s of p.sections || []) {
    const body = (s.body || []).join("\n").trim();
    blocks.push(`## ${s.heading}` + (body ? `\n${body}` : ""));
  }
  return blocks.join("\n\n") + "\n";
}

function findSection(parsed, heading) {
  const want = heading.toLowerCase();
  return (parsed.sections || []).find((s) => s.heading.toLowerCase() === want) || null;
}

/** Get or create a canonical section, returning it. */
function ensureSection(parsed, heading) {
  let s = findSection(parsed, heading);
  if (!s) {
    s = { heading, body: [] };
    parsed.sections.push(s);
  }
  return s;
}

/** Bullet lines ("- ..." / "- [ ] ...") in a section body, trimmed. */
function bulletsOf(section) {
  if (!section) return [];
  return section.body.filter((l) => /^\s*[-*]\s+/.test(l)).map((l) => l.trim());
}

function norm(s) {
  // Treat any run of non-alphanumerics as a single space so "rate-limit" and
  // "rate limit" dedup to the same key.
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Strip "- " / "- [ ] " / "- [x] " bullet/checkbox prefix from a line. */
function bulletText(line) {
  return String(line || "")
    .replace(/^\s*[-*]\s+/, "")
    .replace(/^\[[ xX]\]\s*/, "")
    .trim();
}

// ---------------------------------------------------------------------------
// Weekly plan: scaffold + structured merge (pure on text in/out)
// ---------------------------------------------------------------------------

/** The canonical empty weekly-plan skeleton. */
function emptyWeeklyText(weekOf, objectives = []) {
  const parsed = { title: `Week of ${weekOf}`, preamble: [], sections: [] };
  for (const h of SECTIONS) ensureSection(parsed, h);
  if (objectives.length) {
    findSection(parsed, "Objectives").body = objectives.map((o) => `- [ ] ${o}`);
  }
  return joinSections(parsed);
}

/**
 * mergeWeeklyText(md, patch) -> md  (pure)
 *
 * patch: {
 *   objectives?: string[],        add (deduped) as unchecked objectives
 *   checkObjectives?: string[],   mark matching objectives as done ([x])
 *   progress?: string[],          append bullets to Progress
 *   blockers?: string[],          merge into Blockers with "(seen Nx, since DATE)"
 *   dailySummary?: {date, text},  append/replace the day's line in Daily log
 *   date?: string,                date used for blocker bookkeeping
 * }
 */
function mergeWeeklyText(md, patch, weekOf) {
  const parsed = md && md.trim() ? splitSections(md) : splitSections(emptyWeeklyText(weekOf));
  if (!parsed.title) parsed.title = `Week of ${weekOf}`;
  for (const h of SECTIONS) ensureSection(parsed, h);
  // Normalize: drop trailing blank lines in every section so appends don't
  // leave interior gaps (re-parsing reintroduces a trailing blank otherwise).
  for (const s of parsed.sections) {
    while (s.body.length && s.body[s.body.length - 1].trim() === "") s.body.pop();
  }
  const date = patch.date || "";

  // Objectives — REPLACE the whole list (manual "set this week's priorities").
  if (patch.setObjectives) {
    const sec = ensureSection(parsed, "Objectives");
    sec.body = patch.setObjectives
      .map((o) => (typeof o === "string" ? o : o.text))
      .filter(Boolean)
      .map((t) => `- [ ] ${t}`);
  }

  // Objectives — add new (deduped by normalized text).
  if (patch.objectives && patch.objectives.length) {
    const sec = ensureSection(parsed, "Objectives");
    const have = new Set(bulletsOf(sec).map((b) => norm(bulletText(b))));
    for (const o of patch.objectives) {
      if (!o) continue;
      if (have.has(norm(o))) continue;
      have.add(norm(o));
      sec.body.push(`- [ ] ${o}`);
    }
  }

  // Objectives — check off resolved ones.
  if (patch.checkObjectives && patch.checkObjectives.length) {
    const sec = ensureSection(parsed, "Objectives");
    const wants = patch.checkObjectives.map(norm);
    sec.body = sec.body.map((l) => {
      if (!/^\s*[-*]\s+/.test(l)) return l;
      if (wants.includes(norm(bulletText(l)))) {
        return l.replace(/^(\s*[-*]\s+)\[[ xX]\]/, "$1[x]").replace(/^(\s*[-*]\s+)(?!\[)/, "$1[x] ");
      }
      return l;
    });
  }

  // Progress — append dated bullets.
  if (patch.progress && patch.progress.length) {
    const sec = ensureSection(parsed, "Progress");
    for (const p of patch.progress) {
      if (p) sec.body.push(`- ${date ? `${date}: ` : ""}${p}`);
    }
  }

  // Blockers — dedup by text, track "(seen Nx, since DATE)".
  if (patch.blockers && patch.blockers.length) {
    const sec = ensureSection(parsed, "Blockers");
    for (const b of patch.blockers) {
      if (!b) continue;
      const idx = sec.body.findIndex(
        (l) => /^\s*[-*]\s+/.test(l) && norm(stripBlockerSuffix(bulletText(l))) === norm(b)
      );
      if (idx >= 0) {
        const cur = parseBlockerLine(sec.body[idx]);
        sec.body[idx] = formatBlockerLine(cur.text, cur.count + 1, cur.since || date);
      } else {
        sec.body.push(formatBlockerLine(b, 1, date));
      }
    }
  }

  // Daily log — one line per date (replace if the date already has a line).
  if (patch.dailySummary && patch.dailySummary.date) {
    const sec = ensureSection(parsed, "Daily log");
    const { date: dd, text } = patch.dailySummary;
    const line = `- ${dd} — ${text} → log/${dd}.md`;
    const idx = sec.body.findIndex((l) => l.includes(`- ${dd} —`));
    if (idx >= 0) sec.body[idx] = line;
    else sec.body.push(line);
  }

  // Trim trailing blank lines inside each canonical section body.
  for (const s of parsed.sections) {
    while (s.body.length && s.body[s.body.length - 1].trim() === "") s.body.pop();
  }
  return joinSections(parsed);
}

const BLOCKER_SUFFIX = /\s*\(seen\s+(\d+)x,\s*since\s+(\S+)\)\s*$/i;
function stripBlockerSuffix(text) {
  return String(text || "").replace(BLOCKER_SUFFIX, "").trim();
}
function parseBlockerLine(line) {
  const text = bulletText(line);
  const m = BLOCKER_SUFFIX.exec(text);
  return {
    text: stripBlockerSuffix(text),
    count: m ? parseInt(m[1], 10) : 1,
    since: m ? m[2] : null,
  };
}
function formatBlockerLine(text, count, since) {
  const suffix = since ? ` (seen ${count}x, since ${since})` : ` (seen ${count}x)`;
  return `- ${text}${suffix}`;
}

/**
 * weeklyView(md) -> { objectives:[{text,done}], progress:[], blockers:[{text,count,since}], whereToLook:[], daily:[] }
 * Read-only projection used by status/UI/prompts. Pure.
 */
function weeklyView(md) {
  const parsed = splitSections(md || "");
  const objSec = findSection(parsed, "Objectives");
  const objectives = bulletsOf(objSec).map((l) => ({
    text: bulletText(l),
    done: /^\s*[-*]\s+\[[xX]\]/.test(l),
  }));
  const blockers = bulletsOf(findSection(parsed, "Blockers")).map((l) => parseBlockerLine(l));
  return {
    objectives,
    progress: bulletsOf(findSection(parsed, "Progress")).map(bulletText),
    blockers,
    whereToLook: bulletsOf(findSection(parsed, "Where to look")).map(bulletText),
    daily: bulletsOf(findSection(parsed, "Daily log")).map(bulletText),
  };
}

// ---------------------------------------------------------------------------
// I/O wrappers (confined to plan/ under ROOT)
// ---------------------------------------------------------------------------

function ensurePlanDir() {
  fs.mkdirSync(PLAN_DIR, { recursive: true });
}

/** Guard: agent only ever writes inside its own plan/ dir. */
function assertPlanPath(p) {
  const abs = path.resolve(p);
  if (abs !== PLAN_DIR && !abs.startsWith(PLAN_DIR + path.sep)) {
    throw new Error(`refusing to write outside plan dir: ${abs}`);
  }
}

function readProjectPlan() {
  try {
    return fs.readFileSync(PROJECT_PATH, "utf8");
  } catch {
    return "";
  }
}

function writeProjectPlan(text) {
  ensurePlanDir();
  assertPlanPath(PROJECT_PATH);
  fs.writeFileSync(PROJECT_PATH, String(text || "").replace(/\s*$/, "") + "\n");
}

function readWeeklyPlan(weekOf) {
  try {
    return fs.readFileSync(weeklyPlanPath(weekOf), "utf8");
  } catch {
    return "";
  }
}

function writeWeeklyPlan(weekOf, text) {
  ensurePlanDir();
  const p = weeklyPlanPath(weekOf);
  assertPlanPath(p);
  fs.writeFileSync(p, String(text || "").replace(/\s*$/, "") + "\n");
}

/** Read-modify-write the weekly plan markdown with a structured patch. */
function mergeIntoWeeklyPlan(weekOf, patch) {
  const cur = readWeeklyPlan(weekOf);
  const next = mergeWeeklyText(cur, patch || {}, weekOf);
  writeWeeklyPlan(weekOf, next);
  return next;
}

/**
 * parseObjectiveReply(text) -> string[]
 * Turn a free-text instructor reply into objective lines: split on newlines,
 * strip "1." / "-" / "•" prefixes, drop empties. A single-line reply with no
 * breaks becomes a one-item list. Capped to keep the shortlist short.
 */
function parseObjectiveReply(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:\d+[.)]|[-*•])\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 6);
}

/** List existing weekly plans (newest first) → [{ weekOf, file }]. */
function listWeeklyPlans() {
  let names = [];
  try {
    names = fs.readdirSync(PLAN_DIR);
  } catch {
    return [];
  }
  return names
    .map((n) => /^week-(\d{4}-\d{2}-\d{2})\.md$/.exec(n))
    .filter(Boolean)
    .map((m) => ({ weekOf: m[1], file: m[0] }))
    .sort((a, b) => (a.weekOf < b.weekOf ? 1 : -1));
}

module.exports = {
  // paths / dates
  ROOT,
  PLAN_DIR,
  PROJECT_PATH,
  SECTIONS,
  mondayOf,
  weeklyPlanPath,
  ensurePlanDir,
  // pure parse / render / merge
  splitSections,
  joinSections,
  emptyWeeklyText,
  mergeWeeklyText,
  weeklyView,
  // I/O
  readProjectPlan,
  writeProjectPlan,
  readWeeklyPlan,
  writeWeeklyPlan,
  mergeIntoWeeklyPlan,
  listWeeklyPlans,
  parseObjectiveReply,
};
