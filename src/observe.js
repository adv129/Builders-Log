/*
 * Builder Log Agent — Observer (src/).
 *
 * Detects which LOCAL files in the tracked work folders changed since the last
 * run, by diffing the current tree against a snapshot stored in state.json.
 *
 * Pure library module: snapshot(roots) and diff(prev, curr) are stateless
 * functions. All path resolution for data files (state.json) is the caller's
 * responsibility. This module never reads or writes files itself.
 *
 * Multi-root: snapshot accepts EITHER a single string path (legacy — bare
 * relative-path keys) OR an array of root descriptors `{ id, path }` (the
 * registry form — keys are namespaced as `<rootId>/<relPath>` so files from
 * different roots never collide). makeKey/parseKey convert between the two.
 *
 * NOTE: ROOT (the agent repo directory) is path.resolve(__dirname, "..") because
 * this file lives in src/. The scanningSelf guard compares each watch root to
 * ROOT so agent-owned files are skipped when someone points a root at the agent
 * folder.
 */

"use strict";

const fs = require("fs");
const path = require("path");

// Agent repo root — one level up from src/.
const ROOT = path.resolve(__dirname, "..");

// Always ignored, wherever we scan.
const ALWAYS_IGNORE = new Set(["node_modules", ".git", ".DS_Store"]);

// Build-output / vendored / cache directories — skipped wholesale. These hold
// generated artifacts, not the builder's actual work, so changes here are noise
// in both the log and the LLM prompt.
const IGNORE_DIRS = new Set([
  "dist", "build", ".next", "out", "coverage", ".nuxt", ".output",
  "target", "vendor", "__pycache__", ".venv", "venv", "env", ".cache",
  ".turbo", ".parcel-cache", ".gradle", "Pods", ".terraform",
]);

// Lockfiles and machine-generated files — they churn constantly and carry no
// "what did you build" signal, so they only crowd out real code in the delta.
const NOISE_FILES = new Set([
  "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "npm-shrinkwrap.json",
  "bun.lockb", "Cargo.lock", "poetry.lock", "Pipfile.lock", "composer.lock",
  "Gemfile.lock", "go.sum", "next-env.d.ts",
]);

// Binary / media / archive / build-info extensions — never useful as a work
// delta and a pure waste of the per-file excerpt budget if fed to the model.
const NOISE_EXTS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ico", ".icns", ".svg",
  ".mp4", ".mov", ".webm", ".mp3", ".wav", ".avi",
  ".woff", ".woff2", ".ttf", ".eot", ".otf",
  ".zip", ".gz", ".tgz", ".tar", ".rar", ".7z",
  ".pdf", ".wasm", ".so", ".dylib", ".dll", ".class", ".pyc", ".o", ".a", ".bin",
  ".map", ".tsbuildinfo", ".lock", ".log",
]);

/** True if a file name is generated/binary noise we should never track. */
function isNoiseFile(name) {
  if (NOISE_FILES.has(name)) return true;
  if (/\.min\.(js|css)$/i.test(name)) return true;
  const dot = name.lastIndexOf(".");
  if (dot > 0 && NOISE_EXTS.has(name.slice(dot).toLowerCase())) return true;
  return false;
}

/**
 * True if a relative path is one we now ignore — either a noise file or living
 * under an ignored build/output dir. Used to drop PHANTOM deletions: an older
 * state.json snapshot may still list noise files that snapshot() no longer
 * tracks, which would otherwise surface as bogus "deleted" entries on the first
 * run after the ignore rules changed. Real source deletions are unaffected.
 */
function isIgnoredRel(rel) {
  const parts = String(rel || "").split("/");
  const base = parts[parts.length - 1] || "";
  if (isNoiseFile(base)) return true;
  return parts.slice(0, -1).some((seg) => IGNORE_DIRS.has(seg));
}

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
  "plan",
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

// ---------------------------------------------------------------------------
// Namespaced keys: "<rootId>/<relPath>". rootId never contains "/", so the
// first "/" always separates the id from the (possibly nested) relative path.
// ---------------------------------------------------------------------------

function makeKey(rootId, rel) {
  return rootId ? `${rootId}/${rel}` : rel;
}

function parseKey(key) {
  const i = key.indexOf("/");
  if (i === -1) return { rootId: null, rel: key };
  return { rootId: key.slice(0, i), rel: key.slice(i + 1) };
}

/**
 * Normalize the `roots` argument into a list of { id, path } descriptors.
 * Accepts: a string, an array of strings, or an array of { id, path } objects.
 */
function normalizeRoots(roots) {
  if (typeof roots === "string") return [{ id: null, path: roots }];
  if (!Array.isArray(roots)) return [];
  return roots
    .map((r, i) => {
      if (typeof r === "string") return { id: `r${i + 1}`, path: r };
      if (r && typeof r.path === "string") return { id: r.id || `r${i + 1}`, path: r.path };
      return null;
    })
    .filter(Boolean);
}

// Recursively collect work files in one root → mutate `out` with mtimeMs.
// `id` namespaces the keys; pass null for legacy bare-key behavior.
function scanRoot(base, id, out) {
  const scanningSelf = path.resolve(base) === ROOT;
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
        if (IGNORE_DIRS.has(e.name)) continue; // build output / vendored / caches
        walk(full);
      } else if (e.isFile()) {
        if (isNoiseFile(e.name)) continue; // lockfiles / binaries / generated
        const rel = path.relative(base, full);
        out[makeKey(id, rel)] = fs.statSync(full).mtimeMs;
      }
    }
  })(base);
  return out;
}

/**
 * snapshot(roots) -> { key: mtimeMs }
 *
 * roots: a single string path (bare keys) or an array of { id, path } / strings
 * (keys namespaced as `<rootId>/<rel>`).
 */
function snapshot(roots) {
  if (typeof roots === "string") return scanRoot(roots, null, {});
  const out = {};
  for (const r of normalizeRoots(roots)) scanRoot(r.path, r.id, out);
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

module.exports = { snapshot, diff, makeKey, parseKey, normalizeRoots, isNoiseFile, isIgnoredRel };
