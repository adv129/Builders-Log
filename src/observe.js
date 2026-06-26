/*
 * Builder Log Agent — Observer (src/).
 *
 * Detects which LOCAL files in the working folder changed since the last run,
 * by diffing the current tree against a snapshot stored in state.json.
 *
 * Pure library module: snapshot(root) and diff(prev, curr) are stateless
 * functions. All path resolution for data files (state.json) is the caller's
 * responsibility. This module never reads or writes files itself.
 *
 * NOTE: ROOT (the agent repo directory) is path.resolve(__dirname, "..") because
 * this file lives in src/. The scanningSelf guard compares the watch root to ROOT
 * so agent-owned files are skipped when someone points root at the agent folder.
 */

"use strict";

const fs = require("fs");
const path = require("path");

// Agent repo root — one level up from src/.
const ROOT = path.resolve(__dirname, "..");

// Always ignored, wherever we scan.
const ALWAYS_IGNORE = new Set(["node_modules", ".git", ".DS_Store"]);

// Agent-owned entries — ignored ONLY when the watch folder IS the agent's own
// repo root, so a real project's README.md / config.json etc. are never skipped.
const AGENT_FILES = new Set([
  // Source directories
  "src",
  "public",
  "test",
  "docs",
  // Data directories (output, gitignored)
  "log",
  "raw",
  "reports",
  // Misc root files
  "config.json",
  "config.example.json",
  "state.json",
  "package.json",
  "README.md",
  "INSTRUCTOR_ONBOARDING.md",
  "slack-app-manifest.yaml",
  "LICENSE",
  // Sample work folder
  "demo_project",
]);

// Recursively collect work files → { relPath: mtimeMs }.
function snapshot(root) {
  const out = {};
  const scanningSelf = path.resolve(root) === ROOT;
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

module.exports = { snapshot, diff };
