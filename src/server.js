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

// Upsert a KEY=value line in ROOT/.env, preserving comments and other vars.
// Pass value == null / "" to remove the key. Writes the file 0600 (it holds
// secrets) and updates process.env immediately so changes take effect without
// a restart. Never logs the value.
function upsertEnvVar(key, value) {
  const remove = value == null || value === "";
  const prefix = `${key}=`;
  let lines = [];
  if (fs.existsSync(ENV_PATH)) {
    lines = fs.readFileSync(ENV_PATH, "utf8").split(/\r?\n/);
  }
  let found = false;
  const out = [];
  for (const line of lines) {
    if (line.trim().startsWith(prefix)) {
      found = true;
      if (!remove) out.push(`${key}=${value}`);
      continue; // when removing, drop the old line
    }
    out.push(line);
  }
  if (!found && !remove) out.push(`${key}=${value}`);
  let text = out.join("\n").replace(/\n+$/, "\n");
  if (!text.endsWith("\n")) text += "\n";
  fs.writeFileSync(ENV_PATH, text, { mode: 0o600 });
  try { fs.chmodSync(ENV_PATH, 0o600); } catch { /* best effort */ }
  if (remove) delete process.env[key];
  else process.env[key] = value;
}

// ─── Core requires ────────────────────────────────────────────────────────────

const http = require("http");
const { spawn, execFile } = require("child_process");

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

/** Promisified execFile that resolves { stdout, stderr, code } instead of throwing. */
function run(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 5 * 60 * 1000 }, (err, stdout, stderr) => {
      resolve({
        stdout: stdout || "",
        stderr: stderr || "",
        code: err && typeof err.code === "number" ? err.code : err ? 1 : 0,
        spawnErr: err && err.code === "ENOENT" ? err : null,
      });
    });
  });
}

/**
 * Open the OS-native folder chooser and resolve the selected absolute path.
 * Works because the server runs on the user's own machine (127.0.0.1).
 * Returns { path } on choose, { canceled: true } if dismissed, or
 * { error } if no native picker is available on this platform.
 *
 *   macOS   → osascript `choose folder`
 *   Linux   → zenity, falling back to kdialog
 *   Windows → PowerShell FolderBrowserDialog
 */
async function pickFolderNative() {
  const platform = process.platform;

  if (platform === "darwin") {
    const script =
      'POSIX path of (choose folder with prompt "Select the folder Builder Log should watch" ' +
      "default location (path to home folder))";
    const { stdout, stderr, code } = await run("osascript", ["-e", script]);
    if (code === 0) return { path: stdout.trim().replace(/\/+$/, "") };
    if (/-128|User canceled/i.test(stderr)) return { canceled: true };
    return { error: stderr.trim() || "folder picker failed" };
  }

  if (platform === "linux") {
    let r = await run("zenity", ["--file-selection", "--directory", "--title", "Select the folder Builder Log should watch"]);
    if (r.spawnErr) {
      r = await run("kdialog", ["--getexistingdirectory", process.env.HOME || "/"]);
      if (r.spawnErr) return { error: "no native folder picker found (install zenity or kdialog)" };
    }
    if (r.code === 0 && r.stdout.trim()) return { path: r.stdout.trim().replace(/\/+$/, "") };
    return { canceled: true }; // zenity/kdialog exit non-zero on cancel
  }

  if (platform === "win32") {
    const ps =
      "Add-Type -AssemblyName System.Windows.Forms; " +
      "$d = New-Object System.Windows.Forms.FolderBrowserDialog; " +
      "if ($d.ShowDialog() -eq 'OK') { [Console]::Out.Write($d.SelectedPath) }";
    const { stdout } = await run("powershell", ["-NoProfile", "-STA", "-Command", ps]);
    if (stdout.trim()) return { path: stdout.trim() };
    return { canceled: true };
  }

  return { error: `native folder picker not supported on ${platform}` };
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

  // GET /api/pick-folder — open the OS-native folder chooser (Finder/Explorer/
  // file dialog) and return the selected absolute path. Blocks until the user
  // picks or cancels. Only meaningful because the server runs on the user's
  // own machine. Returns { path } | { canceled: true } | { error }.
  if (req.method === "GET" && pathname === "/api/pick-folder") {
    try {
      const result = await pickFolderNative();
      json(res, 200, result);
    } catch (e) {
      if (!res.headersSent) apiError(res, 500, e.message);
    }
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

  // GET /api/slack/test — verify the Slack bot token works (auth.test).
  // Non-throwing at the action layer: returns { connected, message, ... } so
  // the Settings UI can render a friendly status without a 500.
  if (req.method === "GET" && pathname === "/api/slack/test") {
    try {
      const result = await slackActions.checkConnection();
      json(res, 200, result);
    } catch (e) {
      if (!res.headersSent) apiError(res, 500, e.message);
    }
    return;
  }

  // POST /api/slack/token — save the Slack bot token to .env and hot-load it.
  // Body: { token }. An empty/missing token removes it. The token is written to
  // .env (NEVER config.json), the file is chmod 0600, and process.env is updated
  // in place so no restart is needed. The token is never echoed back. Safe only
  // because this server is bound to 127.0.0.1 (single user, local machine).
  if (req.method === "POST" && pathname === "/api/slack/token") {
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      apiError(res, 400, "invalid JSON");
      return;
    }
    const token = typeof body.token === "string" ? body.token.trim() : "";
    try {
      upsertEnvVar("SLACK_BOT_TOKEN", token || null);
      if (!token) {
        json(res, 200, { saved: true, connected: false, reason: "no-token", message: "Slack token removed." });
        return;
      }
      // Saved — immediately verify so the UI can confirm in one step.
      const result = await slackActions.checkConnection();
      json(res, 200, { saved: true, ...result });
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
