#!/usr/bin/env node
/*
 * Builder Log Agent — Observer (Phase 0/1)
 *
 * Detects which LOCAL files in the working folder changed since the last run,
 * by diffing the current tree against a snapshot stored in state.json.
 *
 * Each file is classified as new / modified / deleted. The observer is
 * read-only by default and prints the delta as JSON. Pass --commit to write
 * the new snapshot + lastRun into state.json (do this once the day's entry
 * is finalized, so a re-run before answering doesn't lose the delta).
 *
 * Usage:
 *   node observe.js            # print today's delta (JSON)
 *   node observe.js --commit   # print delta AND update the snapshot
 *   node observe.js --root DIR # watch a different folder
 */

const fs = require("fs");
const path = require("path");

const HERE = __dirname;
const STATE_PATH = path.join(HERE, "state.json");

// Always ignored, wherever we scan.
const ALWAYS_IGNORE = new Set(["node_modules", ".git", ".DS_Store"]);

// Agent-owned files — ignored ONLY when the watch folder IS the agent's own dir,
// so a real project's README.md / config.json etc. are never silently skipped.
const AGENT_FILES = new Set([
  "observe.js",
  "onboard.js",
  "builder-log-agent.js",
  "config.json",
  "state.json",
  "PLAN.md",
  "README.md",
  "INSTRUCTOR_ONBOARDING.md",
  "log",
  "demo_project",
]);

function parseArgs() {
  const a = process.argv.slice(2);
  const commit = a.includes("--commit");
  const rootIdx = a.indexOf("--root");
  const root = rootIdx !== -1 && a[rootIdx + 1] ? path.resolve(a[rootIdx + 1]) : HERE;
  return { commit, root };
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
  } catch {
    return { lastRun: null, files: {}, commitments: [], blockers: [], bossThread: [] };
  }
}

// Recursively collect work files → { relPath: mtimeMs }.
function snapshot(root) {
  const out = {};
  const scanningSelf = path.resolve(root) === HERE;
  (function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (ALWAYS_IGNORE.has(e.name)) continue;
      if (scanningSelf && AGENT_FILES.has(e.name)) continue;
      if (e.name.startsWith(".")) continue; // skip dotfiles/dirs
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(full);
      } else if (e.isFile()) {
        const rel = path.relative(root, full);
        out[rel] = fs.statSync(full).mtimeMs;
      }
    }
  })(root);
  return out;
}

function diff(prev, curr) {
  const isFirstRun = !prev || Object.keys(prev).length === 0;
  const added = [], modified = [], deleted = [];
  for (const [p, m] of Object.entries(curr)) {
    if (!(p in (prev || {}))) added.push(p);
    else if (prev[p] !== m) modified.push(p);
  }
  for (const p of Object.keys(prev || {})) {
    if (!(p in curr)) deleted.push(p);
  }
  return { isFirstRun, added: added.sort(), modified: modified.sort(), deleted: deleted.sort() };
}

function main() {
  const { commit, root } = parseArgs();
  const state = loadState();
  const curr = snapshot(root);
  const d = diff(state.files, curr);

  const report = {
    root,
    lastRun: state.lastRun,
    counts: { new: d.added.length, modified: d.modified.length, deleted: d.deleted.length },
    new: d.added,
    modified: d.modified,
    deleted: d.deleted,
    isFirstRun: d.isFirstRun,
    openCommitments: state.commitments,
    openBlockers: state.blockers,
    committed: false,
  };

  if (commit) {
    state.files = curr;
    state.lastRun = new Date().toISOString();
    fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + "\n");
    report.committed = true;
    report.lastRun = state.lastRun;
  }

  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
}

module.exports = { snapshot, diff, loadState, STATE_PATH };

if (require.main === module) main();
