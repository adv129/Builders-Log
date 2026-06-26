# Builder Log — Constitution

Non-negotiable principles and the fixed stack. Any change that violates one of these requires an explicit decision to amend the Constitution first, not a quiet override.

---

## 1. Zero runtime dependencies

Node built-ins only (`fs`, `path`, `http`, `child_process`, `net`, `os`). No `npm install`, no `node_modules` to audit or update. The package.json `"dependencies": {}` must stay empty.

Testing uses `node:test` (built-in). The SPA uses vanilla JS/HTML/CSS with no bundler.

## 2. Local-first — data stays on the machine

All files (`config.json`, `state.json`, `raw/`, `log/`, `reports/`) live on the user's machine and are git-ignored. The only things that leave the device are:

- Text sent to the configured model provider for each LLM call.
- Slack messages, when the user explicitly turns Slack on and triggers a send.

There is no cloud sync, no analytics, no telemetry.

## 3. Secrets from environment only — never config.json

`OPENROUTER_API_KEY` and `SLACK_BOT_TOKEN` come from the environment (or `.env`, which is git-ignored). They must never appear in `config.json` or any committed file. The `complete()` seam and the Slack connector enforce this by reading from `process.env` directly.

## 4. Provider-agnostic via the `complete()` seam

The engine (`src/core.js`) never names a model or provider. All LLM calls go through `complete(prompt, opts)` in `src/provider.js`. Adding a new model backend means adding one adapter function there — no other files change.

Current adapters: `claude-p` (Claude Code headless, no API key), `codex` (Codex headless), `openrouter` (any model via API key).

## 5. Record, don't dictate — evidence over activity — no fabricated evidence

The THESIS preamble (in `src/templates/thesis.js`) is prepended to every LLM call:

> RECORD, DON'T DICTATE. You reflect and surface what's there. Never nag, lecture, pad, or cheerlead. Plain language. No emojis. Concise. Evidence over activity.

The extraction prompt requires **real evidence** for a commitment to be marked resolved — not mere intent. The synthesis prompt explicitly says "Never invent evidence." These constraints are tested in `test/templates.test.js`.

## 6. Web app is the primary surface — terminal is minimal

The main way builders interact is the local web app (`npm start` → browser). Onboarding, check-ins, history, settings — all in the browser. The terminal CLI (`src/cli.js`) exists for power users and automation, but is not documented as the primary path.

`src/server.js` binds to `127.0.0.1` only (never `0.0.0.0`). It is single-user and personal.

## 7. RAW vs DERIVED storage split

- **RAW** (`raw/work/`, `raw/chat/`, `raw/instructor/`): inputs captured verbatim, append-only, never rewritten. This is the audit trail for every "evidence, not activity" claim.
- **DERIVED** (`log/`, `reports/`, computed parts of `state.json`): synthesized output, regenerable from RAW. If prompts improve, past history can be re-derived.

The agent stores only pointers, short excerpts, and a file-mtime snapshot — never full copies of the builder's project files.

---

## Fixed stack (do not change without amending this document)

| Layer | Choice | Reason |
|---|---|---|
| Runtime | Node.js ≥ 18 | Built-in `node:test`, `fetch`, stable API |
| Language | JavaScript (CommonJS) | Zero build step; runs anywhere Node runs |
| HTTP server | `node:http` | Zero deps; single-user local-only |
| Testing | `node:test` + `node:assert/strict` | Zero deps; included in Node 18+ |
| Frontend | Vanilla HTML/JS/CSS | No bundler, no framework dependencies |
| LLM interface | `complete()` seam in `src/provider.js` | Swap providers by config change |
| Data format | JSON (state, config) + Markdown (logs) | Human-readable; no schema migration tool needed |
