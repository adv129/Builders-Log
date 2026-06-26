/*
 * Builder Log Agent — Local web server (src/server.js).
 *
 * Zero-dependency Node http server that wraps the core engine.
 * Bound to 127.0.0.1 only (never 0.0.0.0 — single-user, personal data).
 *
 * Start:   node src/server.js
 * Options: --no-open   skip auto-opening the browser
 * Env:     PORT        override default port (4178)
 *          CI          skip auto-open when set
 *
 * .env loading happens before any other require so OPENROUTER_API_KEY /
 * SLACK_BOT_TOKEN are available without --env-file.
 */

"use strict";

// ─── .env loader ─────────────────────────────────────────────────────────────
// Parse ROOT/.env and set env vars that aren't already set.
// Must run before anything else reads process.env.

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const ENV_PATH = path.join(ROOT, ".env");

if (fs.existsSync(ENV_PATH)) {
  try {
    const lines = fs.readFileSync(ENV_PATH, "utf8").split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim();
      // Don't overwrite variables already in the environment.
      if (key && !(key in process.env)) {
        process.env[key] = val;
      }
    }
  } catch {
    // Non-fatal: .env unreadable, continue without it.
  }
}

// ─── Core requires ────────────────────────────────────────────────────────────

const http = require("http");
const { spawn } = require("child_process");

const core = require("./core");
const { instructorDoc } = require("./templates/onboard");
const slackActions = require("./slack-actions");

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_PORT = parseInt(process.env.PORT || "4178", 10);
const MAX_PORT_TRIES = 10;
const PUBLIC_DIR = path.join(ROOT, "public");
const CONFIG_PATH = path.join(ROOT, "config.json");

/** Extension → Content-Type map for static files. */
const MIME = {
  html: "text/html; charset=utf-8",
  js:   "application/javascript; charset=utf-8",
  css:  "text/css; charset=utf-8",
  json: "application/json; charset=utf-8",
  svg:  "image/svg+xml",
  png:  "image/png",
  ico:  "image/x-icon",
};

// ─── CLI flags ────────────────────────────────────────────────────────────────

const NO_OPEN = process.argv.includes("--no-open");

// ─── Concurrency lock ─────────────────────────────────────────────────────────
// Prevents two simultaneous /api/ask or /api/sync calls from racing on state.json.

let busy = false;

// ─── Active port ──────────────────────────────────────────────────────────────
// Set once the server binds; used to build the self-referencing appUrl for
// Slack reminders (so the reminder DM links back to the running instance).

let activePort = null;

// ─── Small utilities ──────────────────────────────────────────────────────────

/** Send a JSON response. */
function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

/** Send a JSON error response. */
function apiError(res, status, message) {
  json(res, status, { error: message });
}

/** Collect the full request body as a UTF-8 string. */
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

/**
 * Deep-merge src into dst (mutates dst).
 * Arrays from src overwrite; plain objects are merged recursively.
 */
function deepMerge(dst, src) {
  for (const [k, v] of Object.entries(src)) {
    if (
      v !== null &&
      typeof v === "object" &&
      !Array.isArray(v) &&
      dst[k] !== null &&
      typeof dst[k] === "object" &&
      !Array.isArray(dst[k])
    ) {
      deepMerge(dst[k], v);
    } else {
      dst[k] = v;
    }
  }
  return dst;
}

/**
 * Read a value from a nested object by dot-path.
 * get(obj, "builder.name") → obj.builder.name
 */
function getByPath(obj, dotPath) {
  return dotPath.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

// ─── Request handler ──────────────────────────────────────────────────────────

async function handleRequest(req, res) {
  const url = new URL(req.url, "http://127.0.0.1");
  const pathname = url.pathname;

  // Permissive CORS for local SPA use.
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // ── Static file serving ────────────────────────────────────────────────────

  if (req.method === "GET" && !pathname.startsWith("/api/")) {
    const filePath =
      pathname === "/" || pathname === ""
        ? path.join(PUBLIC_DIR, "index.html")
        : path.join(PUBLIC_DIR, pathname.replace(/^\/+/, ""));

    // Path-traversal guard.
    const rel = path.relative(PUBLIC_DIR, filePath);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      apiError(res, 400, "invalid path");
      return;
    }

    const ext = path.extname(filePath).slice(1).toLowerCase();
    const contentType = MIME[ext] || "application/octet-stream";

    try {
      const content = fs.readFileSync(filePath);
      res.writeHead(200, {
        "Content-Type": contentType,
        "Content-Length": content.length,
      });
      res.end(content);
    } catch {
      apiError(res, 404, "not found");
    }
    return;
  }

  // ── JSON API ───────────────────────────────────────────────────────────────

  // GET /api/status
  if (req.method === "GET" && pathname === "/api/status") {
    const cfg = core.loadConfig();
    const state = core.loadState();
    json(res, 200, core.statusView(cfg || {}, state));
    return;
  }

  // GET /api/config
  if (req.method === "GET" && pathname === "/api/config") {
    const cfg = core.loadConfig();
    json(res, 200, cfg || {});
    return;
  }

  // POST /api/config — merge partial or full config; validate; write.
  if (req.method === "POST" && pathname === "/api/config") {
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      apiError(res, 400, "invalid JSON");
      return;
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      apiError(res, 400, "body must be a JSON object");
      return;
    }

    // Load existing config (fall back to empty object so deepMerge creates it).
    const cfg = core.loadConfig() || {};

    // Detect instructor preference fields in the patch before merging.
    const INSTRUCTOR_PREF_FIELDS = [
      "caresAbout", "wantsFlaggedEarly", "cadence",
      "format", "notUseful", "currentGoal", "raw",
    ];
    const instructorPatch = (typeof body.instructor === "object" && body.instructor !== null)
      ? body.instructor
      : {};
    const hasPrefField = INSTRUCTOR_PREF_FIELDS.some((k) => k in instructorPatch);

    // Merge patch into config (never clobbers unrelated fields).
    deepMerge(cfg, body);

    // If an instructor preference field was supplied, mark the source.
    if (hasPrefField) {
      if (!cfg.instructor || typeof cfg.instructor !== "object") cfg.instructor = {};
      cfg.instructor.preferencesSource = "instructor";
    }

    // Validate required fields.
    const REQUIRED = ["root", "builder.name", "builder.project", "instructor.name"];
    const missing = REQUIRED.filter((p) => {
      const v = getByPath(cfg, p);
      return v == null || v === "";
    });

    // Unlock setup when all required fields are present.
    if (missing.length === 0) {
      cfg.setupComplete = true;
    }

    // Advisory notes.
    const notes = [];
    if (cfg.instructor?.preferencesSource === "default") {
      notes.push(
        "instructor.preferencesSource is 'default' — the instructor has not customized their preferences yet. " +
        "Share the /api/instructor-doc questionnaire to collect real preferences."
      );
    }

    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + "\n");

    json(res, 200, { ok: true, config: cfg, missing, notes });
    return;
  }

  // GET /api/providers
  if (req.method === "GET" && pathname === "/api/providers") {
    json(res, 200, [
      {
        id: "claude-p",
        label: "Claude Code (claude -p)",
        needsKey: false,
        available: true, // always: uses user's existing claude login
      },
      {
        id: "codex",
        label: "Codex (codex exec)",
        needsKey: false,
        available: true, // optimistic; depends on `codex` being installed and logged in
      },
      {
        id: "openrouter",
        label: "OpenRouter",
        needsKey: true,
        available: !!process.env.OPENROUTER_API_KEY,
      },
    ]);
    return;
  }

  // GET /api/fs?dir=<path> — folder picker helper
  if (req.method === "GET" && pathname === "/api/fs") {
    const dirParam = url.searchParams.get("dir") || process.env.HOME || "/";
    const resolved = path.resolve(dirParam);
    const parent = path.dirname(resolved);

    let dirs = [];
    try {
      const entries = fs.readdirSync(resolved, { withFileTypes: true });
      dirs = entries
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .sort();
    } catch (e) {
      apiError(res, 400, `cannot read directory: ${e.message}`);
      return;
    }

    json(res, 200, { path: resolved, parent, dirs });
    return;
  }

  // POST /api/ask
  if (req.method === "POST" && pathname === "/api/ask") {
    if (busy) {
      apiError(res, 409, "busy");
      return;
    }
    busy = true;
    try {
      const cfg = core.loadConfig();
      if (!cfg) {
        apiError(res, 400, "no config — run setup first");
        return;
      }
      const state = core.loadState();
      core.ensureDirs();
      const result = await core.runAsk(cfg, state);
      json(res, 200, result);
    } catch (e) {
      if (!res.headersSent) apiError(res, 500, e.message);
    } finally {
      busy = false;
    }
    return;
  }

  // POST /api/sync — body: { answers: [{question, answer}] } | { answersText }
  if (req.method === "POST" && pathname === "/api/sync") {
    if (busy) {
      apiError(res, 409, "busy");
      return;
    }
    busy = true;
    try {
      let body;
      try {
        body = JSON.parse(await readBody(req));
      } catch {
        apiError(res, 400, "invalid JSON");
        return;
      }
      const cfg = core.loadConfig();
      if (!cfg) {
        apiError(res, 400, "no config — run setup first");
        return;
      }
      const state = core.loadState();
      core.ensureDirs();
      // Forward the input shape to core (it handles both forms).
      const result = await core.runSync(cfg, state, body);
      json(res, 200, result);
    } catch (e) {
      if (!res.headersSent) apiError(res, 500, e.message);
    } finally {
      busy = false;
    }
    return;
  }

  // GET /api/logs — list all log entries, newest first
  if (req.method === "GET" && pathname === "/api/logs") {
    const logDir = path.join(ROOT, "log");
    let logs = [];
    try {
      logs = fs
        .readdirSync(logDir)
        .filter((f) => f.endsWith(".md"))
        .map((f) => ({ date: f.slice(0, -3), file: f }))
        .sort((a, b) => b.date.localeCompare(a.date));
    } catch {
      // log dir may not exist yet — return empty array
    }
    json(res, 200, logs);
    return;
  }

  // GET /api/logs/:date — read a single log entry
  const logsDateMatch = pathname.match(/^\/api\/logs\/(\d{4}-\d{2}-\d{2})$/);
  if (req.method === "GET" && logsDateMatch) {
    const date = logsDateMatch[1];
    const logPath = path.join(ROOT, "log", `${date}.md`);
    try {
      const markdown = fs.readFileSync(logPath, "utf8");
      json(res, 200, { date, markdown });
    } catch {
      apiError(res, 404, `no log for ${date}`);
    }
    return;
  }

  // GET /api/instructor-doc — INSTRUCTOR_ONBOARDING.md text for sharing
  if (req.method === "GET" && pathname === "/api/instructor-doc") {
    const cfg = core.loadConfig();
    const markdown = instructorDoc(cfg);
    json(res, 200, { markdown });
    return;
  }

  // POST /api/reminder — DM the builder a check-in reminder with a link to the web app.
  if (req.method === "POST" && pathname === "/api/reminder") {
    const cfg = core.loadConfig();
    if (!cfg) {
      apiError(res, 400, "no config — run setup first");
      return;
    }
    try {
      const appUrl = `http://127.0.0.1:${activePort || DEFAULT_PORT}`;
      const result = await slackActions.sendReminder(cfg, { appUrl });
      json(res, 200, result);
    } catch (e) {
      if (!res.headersSent) apiError(res, 500, e.message);
    }
    return;
  }

  // POST /api/send-instructor — DM the instructor draft for a given date.
  // Body: { date } — optional, defaults to today.
  if (req.method === "POST" && pathname === "/api/send-instructor") {
    let body = {};
    try {
      const raw = await readBody(req);
      if (raw && raw.trim()) body = JSON.parse(raw);
    } catch {
      // Body is optional and non-fatal to parse; default to empty.
    }
    const cfg = core.loadConfig();
    if (!cfg) {
      apiError(res, 400, "no config — run setup first");
      return;
    }
    try {
      const result = await slackActions.sendInstructorNote(cfg, { date: body.date });
      json(res, 200, result);
    } catch (e) {
      if (!res.headersSent) apiError(res, 500, e.message);
    }
    return;
  }

  // 404 fallthrough
  apiError(res, 404, `no route: ${req.method} ${pathname}`);
}

// ─── Browser opener ───────────────────────────────────────────────────────────

function openBrowser(url) {
  if (process.env.CI || NO_OPEN) return;
  const opener =
    process.platform === "darwin" ? "open" :
    process.platform === "win32"  ? "cmd"  :
    "xdg-open";
  const args =
    process.platform === "win32" ? ["/c", "start", url] : [url];
  try {
    spawn(opener, args, { stdio: "ignore", detached: true }).unref();
  } catch {
    // Non-fatal: browser launch failed, user can navigate manually.
  }
}

// ─── Server startup with port fallback ────────────────────────────────────────

function startServer(port, triesLeft) {
  const server = http.createServer(async (req, res) => {
    try {
      await handleRequest(req, res);
    } catch (e) {
      // Last-resort catch — handleRequest should not throw, but guard anyway.
      if (!res.headersSent) {
        apiError(res, 500, `internal error: ${e.message}`);
      }
    }
  });

  server.on("error", (e) => {
    if (e.code === "EADDRINUSE" && triesLeft > 0) {
      // Port in use — try the next one.
      startServer(port + 1, triesLeft - 1);
    } else {
      console.error(`[builder-log] Failed to start server on port ${port}: ${e.message}`);
      process.exitCode = 1;
    }
  });

  server.listen(port, "127.0.0.1", () => {
    activePort = port;
    const url = `http://127.0.0.1:${port}`;
    console.log(`Builder Log running at ${url}`);
    openBrowser(url);
  });
}

startServer(DEFAULT_PORT, MAX_PORT_TRIES);
