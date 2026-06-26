# Builders Log

**An agent that turns your daily work into a disciplined log — interviews you about what you actually built, tracks your commitments over time, and surfaces to your instructor only the few things that genuinely need them.**

Built on one principle: **record, don't dictate. Evidence over activity.** It reflects what's really there — it never nags, pads, or cheerleads. It also flags when AI did the thinking that was the point.

It's **provider-agnostic**: plug in Claude Code (`claude -p`, no API key), Codex, or any OpenRouter API key. And it's **local-first**: your work and logs stay on your machine; only model calls (and optional Slack messages) leave.

The **primary interface is a local web app** — open it in your browser to do check-ins, review history, and change settings. No terminal interaction required after setup.

---

## Table of contents
- [How it works](#how-it-works)
- [Quick start](#quick-start)
- [Power users / CLI](#power-users--cli)
- [Choosing your LLM provider](#choosing-your-llm-provider)
- [Slack (optional)](#slack-optional)
- [Where your data lives](#where-your-data-lives)
- [Project layout](#project-layout)
- [Privacy & security](#privacy--security)
- [Troubleshooting](#troubleshooting)
- [Architecture](#architecture)

---

## How it works

A simple two-step loop. Each step only looks at **what's new since last time**.

```
  1. START ─────────────────────────────────────────────
     You click "Start check-in" in the web app.
     The agent sees which files changed, reads them, and
     asks you 3–5 SPECIFIC questions grounded in your
     actual work.

  2. (you answer in the browser) ───────────────────────

  3. GENERATE ──────────────────────────────────────────
     The agent turns your answers + work into:
       • a Builder Log entry (what you did, the thinking,
         the EVIDENCE, what's blocking, one next commitment)
       • a "For your instructor" note — only the 1–3 things
         that truly need your mentor (triaged by the agent)
       • a friction check (did AI do the thinking?)
     It remembers your commitments and carries them forward.
```

The agent never invents "stall" rules. It judges significance from your accumulated history plus what your instructor said they care about — so it works whether you're shipping code daily or writing a thesis over months.

---

## Quick start

### Prerequisites
- **[Node.js](https://nodejs.org) 18 or newer** (`node --version` to check)
- **One LLM provider.** The default requires [Claude Code](https://www.anthropic.com/claude-code) installed and logged in:
  ```sh
  claude --version   # should print a version
  ```
  (OpenRouter or Codex instead? See [Choosing your LLM provider](#choosing-your-llm-provider).)

### 1. Get the code
```sh
git clone https://github.com/adv129/Builders-Log.git
cd Builders-Log
```
No dependencies to install — Node built-ins only.

### 2. Set up config (or do it in the browser)

**Option A — browser onboarding (recommended):**
```sh
cp config.example.json config.json
npm start
```
Open the URL printed in the terminal. The web app will walk you through onboarding.

**Option B — edit manually:**
```sh
cp config.example.json config.json
```
Open `config.json` and set at minimum:
- `"root"` — the folder to watch (your project). The example points at `./demo_project` so you can try it immediately.
- `"builder.name"` and `"builder.project"` — who you are and what you're building.

### 3. Start the web app
```sh
npm start
```
A browser tab opens automatically at `http://127.0.0.1:4178`. From there:
- If not onboarded: the wizard guides you through provider, folder, and builder setup.
- **Check-in:** click "Start check-in", answer the questions in the browser, click "Generate entry".
- **History:** see past logs rendered in the browser.
- **Settings:** change provider, folder, Slack, or instructor preferences anytime.

### 4. Do your first check-in

In the web app, click **"Start check-in"**. The agent observes changes in your watch folder, generates grounded questions, and shows them inline. Answer each one, then click **"Generate entry"**. Your log entry appears immediately.

> **Try the demo:** with `root` pointing at `./demo_project`, run a check-in to see a full entry generated from sample work.

---

## Power users / CLI

The terminal CLI is available for automation, scripting, or if you prefer the command line:

```sh
node src/cli.js ask     # observe work delta, generate questions → raw/chat/<date>.md
# (edit the "> _answer:_" lines in the file)
node src/cli.js sync    # read answers, synthesize log entry
node src/cli.js status  # print open commitments, blockers, churn
```

Or via npm scripts:
```sh
npm run ask
npm run sync
npm run status
```

The CLI is intentionally minimal — it calls the same engine as the web app.

---

## Choosing your LLM provider

The agent needs exactly one thing from a model: turn a prompt into text. Pick whichever you have.

**Claude Code (default — no API key):**
```json
{ "provider": "claude-p" }
```
Requires Claude Code installed and logged in (`claude --version`). Uses your existing session.

**OpenRouter (any model via an API key):**
```json
{ "provider": "openrouter", "openrouter": { "model": "openai/gpt-4o-mini" } }
```
Add to `.env`:
```
OPENROUTER_API_KEY=sk-or-...
```

**Codex (headless):**
```json
{ "provider": "codex" }
```
Requires the `codex` CLI installed and authenticated (`codex login`). Verify with `codex exec --help` before relying on it (see `docs/research/claude-cli.md`).

Switch providers anytime in Settings in the web app or by editing `config.json`.

---

## Slack (optional)

By default the check-in happens entirely in the web app. Enable Slack for two things:

1. **Reminder DMs** — the agent DMs you "time for your check-in" with a link to the web app.
2. **Instructor delivery** — after a check-in, send the drafted instructor note to your mentor via DM.

> **Full walkthrough: [docs/SLACK_SETUP.md](docs/SLACK_SETUP.md)** (create the app from [`slack-app-manifest.yaml`](slack-app-manifest.yaml), install, find user IDs). Rule: keep it **internal** (public distribution OFF) so you stay on Slack's normal rate limits.

1. Create a Slack app, get a bot token (`xoxb-...`) with scopes: `chat:write`, `im:write`, `im:history`.
2. Add to `.env`:
   ```
   SLACK_BOT_TOKEN=xoxb-...
   ```
3. In the web app Settings, set `chatSurface: "slack"` and fill in `studentUserId` and `instructorUserId`.
4. Use the "Send reminder" and "Send to instructor" buttons in the web app.

---

## Where your data lives

Clean split between **raw inputs** (kept verbatim, never rewritten) and **derived output** (regenerable from raw):

```
config.json              your setup (git-ignored)
state.json               memory: file snapshot, commitments, blockers (git-ignored)
raw/
  work/<date>.json       RAW: which files changed + excerpts (verbatim)
  chat/<date>.md         RAW: the interview transcript (your answers)
  instructor/<date>.md   RAW: drafts for your instructor
log/<date>.md            DERIVED: synthesized Builder Log entry
reports/                 DERIVED: longer-form reports (future)
```

All data is **git-ignored and stays on your machine**.

---

## Project layout

```
Builders-Log/
├── src/
│   ├── core.js              engine: runAsk / runSync / statusView
│   ├── server.js            local web server (http + JSON API, zero deps)
│   ├── cli.js               minimal terminal wrapper (ask / sync / status)
│   ├── provider.js          LLM seam: complete() → claude-p / codex / openrouter
│   ├── observe.js           snapshot() + diff() — detects changed files
│   ├── track.js             pure memory: commitments, blockers, churn
│   ├── slack-actions.js     reminder + instructor delivery (high-level)
│   ├── connectors/
│   │   └── slack.js         Slack API primitives (openDm, postMessage, historySince)
│   └── templates/
│       ├── index.js         manifest (single import point for all templates)
│       ├── thesis.js        THESIS — standing identity preamble
│       ├── ask.js           askQuestions() — Phase 1 interview prompt
│       ├── extract.js       extractFacts() — STRICT JSON extraction prompt
│       ├── synthesize.js    synthesizeEntry() — 3-section log entry prompt
│       └── onboard.js       INSTRUCTOR_QUESTIONS + instructorDoc()
├── public/
│   ├── index.html           SPA shell
│   ├── app.js               SPA logic (vanilla JS)
│   └── style.css            SPA styles
├── test/
│   ├── core.test.js         statusView shape, runAsk no-change, JSON validity
│   ├── observe.test.js      diff logic, snapshot ignore rules
│   ├── templates.test.js    prompt wording contract tests
│   ├── track.test.js        applyExtraction, bumpChurn, historyView, etc.
│   └── slack.test.js        Slack actions against a fake Slack server
├── docs/
│   ├── ARCHITECTURE.md      how the pieces fit
│   ├── CONSTITUTION.md      non-negotiables + fixed stack
│   ├── REMAKE_PLAN.md       the greenfield rewrite plan
│   ├── SLACK_SETUP.md       step-by-step Slack mode setup
│   └── research/
│       └── claude-cli.md    empirical findings on AI-CLI integration
├── demo_project/            sample work folder (try it without your own project)
├── config.example.json      copy to config.json
├── .env.example             copy to .env (secrets go here)
├── slack-app-manifest.yaml  create your Slack app from this
└── package.json
```

---

## Privacy & security

- **Your work and logs never leave your machine** — except text sent to your chosen model provider per call, and (if enabled) Slack messages you explicitly trigger.
- **Secrets are read only from environment variables** (`OPENROUTER_API_KEY`, `SLACK_BOT_TOKEN`) and the git-ignored `.env` — never stored in `config.json` or committed.
- **Messages to your instructor are gated by default** — the agent drafts; you approve before anything is sent. Set `gateInstructorMessages: false` to auto-send.
- `config.json` and `state.json` are git-ignored.
- The web server binds to `127.0.0.1` only — it is never accessible from the network.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `config.json missing or no watch folder set` | `cp config.example.json config.json` and set `root`, or complete onboarding in the browser. |
| `No work changes since last run` | Edit/add a file under your `root`, then start a new check-in. |
| `claude exited with code ...` | Ensure Claude Code is installed and logged in (`claude --version`), or switch provider in Settings. |
| `OPENROUTER_API_KEY not set` | Add it to `.env` or export it in your shell. |
| `SLACK_BOT_TOKEN not set` | Add it to `.env`, or set `chatSurface` back to `"terminal"` in Settings. |
| Port already in use | The server tries up to 10 ports starting from 4178. Or set `PORT=<n>` before `npm start`. |

---

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full picture — engine, surfaces, templates, and data flow.

Non-negotiable principles (zero deps, local-first, secrets from env, provider-agnostic, etc.) are documented in [docs/CONSTITUTION.md](docs/CONSTITUTION.md).

Research notes on `claude -p` / `codex exec` / OpenRouter / Slack rate limits are in [docs/research/claude-cli.md](docs/research/claude-cli.md).

## License

[MIT](LICENSE).
