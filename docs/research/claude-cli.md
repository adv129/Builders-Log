# Builder Log — AI-CLI Integration: Empirical Findings

**Date:** 2026-06-25  
**Purpose:** Dated findings about the external AI-CLI tools this agent integrates with. Reference before making changes that depend on CLI behavior. Verify claims marked UNVERIFIED before relying on them in production.

---

## 1. `claude -p` (Claude Code headless)

**Status: VERIFIED — works on the dev machine.**

- Claude Code drives its LLM via stdin when called with `claude -p`. The full prompt text is piped to the process's stdin and the response text comes back on stdout.
- **No API key required.** Authentication uses the user's existing `claude login` session.
- Invocation: `claude -p` with the prompt written to stdin and the process's stdin closed (`stdin.end()`). The response is captured from stdout.
- Implementation: `src/provider.js` → `claudeP()` adapter using `runCli("claude", ["-p"])`.
- **Observed behavior:** Completions take 10–30 seconds. There is no streaming from `claude -p`; the full response arrives at process close. The SPA shows a spinner during this window.
- No stdout/stderr noise observed when stdin is well-formed. Exit code 0 on success; non-zero on error.
- **Caveat:** `claude -p` behavior may change as Claude Code evolves. Pin-check the version if behavior changes: `claude --version`.

---

## 2. `codex exec -` (Codex headless)

**Status: UNVERIFIED — codex CLI not installed on this machine. Verify before relying in production.**

- Intended invocation: `codex exec - --skip-git-repo-check` with the full prompt on stdin. The `-` flag signals stdin input; `--skip-git-repo-check` allows running outside a git repository.
- `--model <model>` can optionally be passed; omit to use the Codex default.
- Authentication: `codex login` or `CODEX_API_KEY` environment variable.
- **The `exec -` form is the documented headless form** (reads from stdin, prints only the final message to stdout; progress messages go to stderr).
- Implementation: `src/provider.js` → `codex()` adapter.
- **Do not rely on this adapter until tested on a machine with `codex` installed.** Verify: `codex exec --help`, `codex exec - --skip-git-repo-check` with a simple prompt piped in.

---

## 3. OpenRouter (raw HTTPS API)

**Status: REQUEST SHAPE VERIFIED against a local echo server. Live auth UNVERIFIED in this sandbox environment.**

- OpenRouter uses the OpenAI-compatible chat completions API at `https://openrouter.ai/api/v1/chat/completions`.
- Auth: `Authorization: Bearer <OPENROUTER_API_KEY>` header.
- Request body: `{ model, messages: [{ role: "user", content: prompt }] }`.
- **Known sandbox limitation:** This development sandbox strips the `Authorization` header on outbound HTTPS requests. The request shape was verified correct against a local echo server, but live authentication **must be tested on a real machine** (not this sandbox).
- Model selection: `config.openrouter.model` (e.g. `"openai/gpt-4o-mini"`). Defaults to `"openai/gpt-4o-mini"` if not set.
- `X-Title: "Builder Log Agent"` header included for OpenRouter attribution.
- Implementation: `src/provider.js` → `openrouter()` adapter using the built-in `fetch` (Node 18+).

---

## 4. Slack API rate limits

**Status: VERIFIED by reading Slack documentation; not empirically load-tested here.**

- `conversations.history` is throttled to **1 request/minute for Distributed/non-Marketplace apps** (Tier 3 under the public distribution rate limit table).
- **Internal apps** (public distribution OFF) keep **Tier 3 = 50+ requests/minute** for `conversations.history`.
- **Keep the Slack app internal** (public distribution OFF, install to your own workspace only). This is documented in `docs/SLACK_SETUP.md` and enforced by the `slack-app-manifest.yaml`.
- The `src/connectors/slack.js` connector includes Retry-After backoff (HTTP 429 → wait `Retry-After` seconds) to handle transient rate limits regardless of app type.
- `chat.postMessage` and `conversations.open` are Tier 3 / Tier 4 and have comfortable limits for single-user use.

---

## 5. Node.js version

- **Dev machine:** Node 23.x (current at time of writing).
- **Target: Node ≥ 18.** Required for:
  - `node:test` built-in test runner (18.7+).
  - `fetch` global (18.0+, unflagged in 18.18+, fully stable 21+). The OpenRouter adapter uses `fetch`. On Node 18 it may be behind the `--experimental-fetch` flag depending on the patch version; on Node 21+ it is always available.
  - `fs.rmSync` with `{ recursive: true, force: true }` (16.14+).
- **`engines` in `package.json`:** `"node": ">=18"`.
- If supporting older Node is needed: polyfill `fetch` or switch the OpenRouter adapter to `https.request`.
