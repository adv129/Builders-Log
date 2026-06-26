/*
 * Builder Log Agent — Provider seam.
 *
 * The whole framework needs exactly one capability from an LLM:
 *     complete(prompt) -> text
 *
 * Each backend is a small adapter behind that interface, so a user can plug in
 * Claude Code headless (`claude -p`, no API key), Codex headless, or a raw API
 * key (e.g. OpenRouter). The core loop never names a provider — it calls
 * complete() and lets config decide which adapter runs.
 *
 * Adapters receive (prompt, opts). opts.config is the loaded config.json, so an
 * adapter can read model settings (e.g. opts.config.openrouter.model). Secrets
 * come from the environment, never config.json.
 */

const { spawn } = require("child_process");

// Run a CLI agent headlessly: pipe the prompt to stdin, capture stdout.
function runCli(cmd, args) {
  return (prompt) =>
    new Promise((resolve, reject) => {
      const child = spawn(cmd, args, { stdio: ["pipe", "pipe", "inherit"] });
      let out = "";
      child.stdout.on("data", (c) => (out += c));
      child.on("error", reject);
      child.on("close", (code) =>
        code === 0 ? resolve(out.trim()) : reject(new Error(`${cmd} exited with code ${code}`))
      );
      child.stdin.write(prompt);
      child.stdin.end();
    });
}

// --- Adapter: Claude Code headless (`claude -p`) -------------------------
// Uses the user's existing Claude Code login. No API key, no SDK.
function claudeP(prompt) {
  return runCli("claude", ["-p"])(prompt);
}

// --- Adapter: Codex headless (`codex exec`) -----------------------------
// `codex exec -` reads the full prompt from stdin and prints only the final
// message to stdout (progress goes to stderr). `--skip-git-repo-check` lets it
// run outside a git repo. Read-only sandbox is the default — we never let it
// edit files. Auth via the user's existing `codex login` / CODEX_API_KEY.
function codex(prompt, opts = {}) {
  const model = opts.config?.codex?.model;
  const args = ["exec", "-", "--skip-git-repo-check", ...(model ? ["--model", model] : [])];
  return runCli("codex", args)(prompt);
}

// --- Adapter: OpenRouter / raw API key ----------------------------------
// A single chat completion over HTTPS. Key from env OPENROUTER_API_KEY; model
// from config.openrouter.model. Raw providers have no tools — the core loop
// already owns all orchestration, so one call is all we need.
async function openrouter(prompt, opts = {}) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY not set");
  const model = opts.config?.openrouter?.model || "openai/gpt-4o-mini";
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "X-Title": "Builder Log Agent",
    },
    body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }] }),
  });
  if (!res.ok) throw new Error(`openrouter ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error("openrouter: empty completion");
  return text.trim();
}

const ADAPTERS = {
  "claude-p": claudeP,
  codex,
  openrouter,
};

/**
 * complete(prompt, opts) -> Promise<string>
 * opts.provider selects the adapter (default "claude-p").
 * opts.config is passed through so adapters can read model settings.
 */
function complete(prompt, opts = {}) {
  const provider = opts.provider || "claude-p";
  const fn = ADAPTERS[provider];
  if (!fn) throw new Error(`unknown provider: ${provider} (have: ${Object.keys(ADAPTERS).join(", ")})`);
  return fn(prompt, opts);
}

module.exports = { complete, ADAPTERS };
