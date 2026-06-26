# Builders Log

**An agent that turns your daily work into a disciplined log — interviews you about what you actually did, tracks your commitments over time, and surfaces to your mentor only the few things that genuinely need them.**

Built on one principle: **record, don't dictate. Evidence over activity.** It reflects what's really there — it never nags, pads, or cheerleads. It also flags when AI did the thinking that was the point.

It's **provider-agnostic**: plug in your own LLM backend — Claude Code (`claude -p`, no API key), Codex, or any OpenRouter API key. And it's **local-first**: your work and logs stay on your machine; the only things that leave are the model calls (and Slack messages, if you turn that on).

---

## Table of contents
- [How it works](#how-it-works)
- [Quick start](#quick-start) (5 minutes)
- [Commands](#commands)
- [Configuration](#configuration)
- [Choosing your LLM provider](#choosing-your-llm-provider)
- [Slack mode](#slack-mode-optional)
- [Where your data lives](#where-your-data-lives)
- [Project layout](#project-layout)
- [Privacy & security](#privacy--security)
- [Troubleshooting](#troubleshooting)
- [Architecture & roadmap](#architecture--roadmap)

---

## How it works

It's a simple two-step loop you run on a trigger (manually, or later from a cron job). Each step only looks at **what's new since last time**.

```
  1. ASK ───────────────────────────────────────────────
     You worked today. The agent sees which files changed,
     reads them, and asks you 3–5 SPECIFIC questions
     grounded in your actual work.

  2. (you answer) ──────────────────────────────────────
     In the terminal (a markdown file) or in Slack.

  3. SYNC ──────────────────────────────────────────────
     The agent turns your answers + work into:
       • a Builder Log entry (what you did, the thinking,
         the EVIDENCE, what's blocking, one next commitment)
       • a "For your instructor" note — only the 1–3 things
         that truly need your mentor (triaged by the agent)
       • a friction check (did AI do the thinking?)
     It remembers your commitments and carries them forward.
```

The agent never invents "stall" rules. It judges what's significant from your accumulated history plus what your mentor said they care about — so it works the same whether you're shipping code daily or writing a thesis over months.

---

## Quick start

### 1. Prerequisites
- **[Node.js](https://nodejs.org) 18 or newer** (`node --version` to check).
- **One LLM provider.** The default needs nothing extra if you already have [Claude Code](https://www.anthropic.com/claude-code) installed and logged in:
  ```sh
  claude --version   # should print a version
  ```
  (Prefer an API key or Codex instead? See [Choosing your LLM provider](#choosing-your-llm-provider).)

### 2. Get the code
```sh
git clone https://github.com/adv129/Builders-Log.git
cd Builders-Log
```
There are **no dependencies to install** — it uses only Node's built-ins.

### 3. Create your config
```sh
cp config.example.json config.json
```
Open `config.json` and set, at minimum:
- `"root"` — the folder the agent should watch (your project). The example points at the included `./demo_project` so you can try it immediately.
- `"builder"` — your name and a one-line description of what you're building.

### 4. Run your first cycle
```sh
node loop.js ask     # observes changes, asks you grounded questions
```
It writes the questions to `raw/chat/<today>.md`. Open that file and type your answers after each `> _answer:_`. Then:
```sh
node loop.js sync    # reads your answers, writes today's entry
```
Your log entry is now in `log/<today>.md`. 🎉

### 5. Check your standing anytime
```sh
node loop.js status  # open commitments, their age, blockers, file churn
```

> **Try the demo:** with `root` pointed at `./demo_project`, run `ask` → answer a couple questions → `sync` to see a full entry generated from sample work.

---

## Commands

| Command | What it does |
|---|---|
| `node loop.js ask` | Detects changed files since last run, reads them, and asks you 3–5 grounded questions. Writes `raw/work/<date>.json` and `raw/chat/<date>.md`. |
| `node loop.js sync` | Reads your answers, updates your commitments/blockers memory, and writes the synthesized entry to `log/<date>.md`. |
| `node loop.js status` | Prints your open commitments (with age + carried count), blockers seen, and file churn. Pure facts, no LLM call. |
| `node loop.js send-instructor` | (Slack mode) Posts the gated "for your instructor" note after you've reviewed it. |

There are also npm script shortcuts: `npm run ask`, `npm run sync`, `npm run status`.

---

## Configuration

Everything lives in `config.json` (copied from `config.example.json`). Secrets never go here — they go in environment variables.

| Field | Meaning |
|---|---|
| `provider` | Which LLM backend to use: `"claude-p"` (default), `"openrouter"`, or `"codex"`. |
| `openrouter.model` | Model id when using OpenRouter, e.g. `"openai/gpt-4o-mini"`. |
| `codex.model` | Optional model override for Codex (`null` = Codex default). |
| `root` | The folder to watch for your work. Relative (e.g. `./demo_project`) or absolute. |
| `builder.{name,project,context,voice}` | Who you are + what you're building. Sharpens the questions and entries. |
| `instructor.{name,caresAbout,wantsFlaggedEarly,...}` | Your mentor and what they want to see. Drives the triage. Best filled by having them answer `INSTRUCTOR_ONBOARDING.md` (see below). |
| `chatSurface` | `"terminal"` (default) or `"slack"`. |
| `slack.{studentUserId,instructorUserId,gateInstructorMessages}` | Slack target users and whether to require your approval before messaging the instructor. |

### Environment variables (secrets)

| Variable | When you need it |
|---|---|
| `OPENROUTER_API_KEY` | Only if `provider` is `"openrouter"`. |
| `SLACK_BOT_TOKEN` | Only if `chatSurface` is `"slack"`. |

See `.env.example` for a template.

### Optional: onboarding helper

`onboard.js` helps you fill config and capture your mentor's preferences in their own words:
```sh
node onboard.js --check            # what's still missing from config.json
node onboard.js --summary          # human-readable view of your config
node onboard.js --instructor-doc   # generate INSTRUCTOR_ONBOARDING.md to send your mentor
```
Send `INSTRUCTOR_ONBOARDING.md` to your mentor, then paste their answers into the `instructor` block of `config.json`. The triage is shaped by what they actually said they care about.

---

## Choosing your LLM provider

The agent needs exactly one thing from a model: turn a prompt into text. Pick whichever you have.

**Claude Code (default — no API key):**
```json
{ "provider": "claude-p" }
```
Requires Claude Code installed and logged in. Uses your existing session.

**OpenRouter (any model via an API key):**
```json
{ "provider": "openrouter", "openrouter": { "model": "openai/gpt-4o-mini" } }
```
```sh
export OPENROUTER_API_KEY="sk-or-..."
```

**Codex (headless):**
```json
{ "provider": "codex" }
```
Requires the `codex` CLI installed and authenticated (`codex login`). Verify with `codex exec --help` before relying on it.

---

## Slack mode (optional)

By default the conversation happens in the terminal. Switch to Slack and the agent DMs you the questions and reads your replies back on the next run — no always-on server.

1. Create a Slack app and a **bot token** (`xoxb-...`) with scopes: `chat:write`, `im:write`, `im:history`.
2. Set the token in your environment:
   ```sh
   export SLACK_BOT_TOKEN="xoxb-..."
   ```
3. In `config.json`:
   ```json
   {
     "chatSurface": "slack",
     "slack": {
       "studentUserId": "U_your_id",
       "instructorUserId": "U_mentor_id",
       "gateInstructorMessages": true
     }
   }
   ```
4. Use it:
   - `node loop.js ask` → DMs you the questions.
   - Reply in Slack, then `node loop.js sync` → reads your replies, writes the entry.
   - With `gateInstructorMessages: true` (recommended), the note to your mentor is **drafted, not sent** — review it, then `node loop.js send-instructor` to post. Set it to `false` to auto-send.

---

## Where your data lives

The agent keeps a clean split between **raw inputs** (kept verbatim, never rewritten) and **derived output** (regenerable from raw):

```
config.json        your setup (git-ignored)
state.json         memory: file snapshot, commitments, blockers (git-ignored)
raw/
  work/<date>.json   RAW: which files changed + excerpts
  chat/<date>.md     RAW: the interview transcript
  instructor/<date>.md  RAW: notes to / replies from your mentor
log/<date>.md      DERIVED: your synthesized Builder Log entry
reports/           DERIVED: longer-form reports (future)
```

`config.json`, `state.json`, `raw/`, `log/`, and `reports/` are **git-ignored** — they're yours and stay local.

---

## Project layout

```
Builders-Log/
├── loop.js              # the orchestrator: ask / sync / status / send-instructor
├── provider.js          # the LLM seam: claude-p · openrouter · codex
├── observe.js           # detects which files changed since last run
├── track.js             # accumulates your commitments/blockers memory
├── onboard.js           # setup + mentor-onboarding helper
├── connectors/
│   └── slack.js         # Slack send/read (used when chatSurface = "slack")
├── demo_project/        # sample work so you can try it immediately
├── config.example.json  # copy to config.json
├── .env.example         # copy to .env (secrets)
├── docs/ARCHITECTURE.md # how it all fits together (deeper dive)
├── PLAN.md              # design notes & roadmap
└── builder-log-agent.js # the original v1 one-shot prototype (kept for reference)
```

---

## Privacy & security

- **Your work and logs never leave your machine** — except the text sent to your chosen model provider for each call, and (if enabled) messages sent to Slack.
- **Secrets are read only from environment variables** (`OPENROUTER_API_KEY`, `SLACK_BOT_TOKEN`) — never stored in config or committed.
- **Messages to your mentor are gated by default** — the agent drafts; you approve before anything is sent.
- `config.json` and `state.json` are git-ignored so you don't accidentally publish personal context.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `config.json missing or no watch folder set` | `cp config.example.json config.json` and set `root`. |
| `No work changes since last run` | Edit/add a file under your `root`, then run `ask` again. |
| `claude exited with code ...` | Ensure Claude Code is installed and logged in (`claude --version`), or switch `provider`. |
| `OPENROUTER_API_KEY not set` | `export OPENROUTER_API_KEY=...` (or change `provider`). |
| `SLACK_BOT_TOKEN not set` | `export SLACK_BOT_TOKEN=...` (or set `chatSurface` back to `"terminal"`). |
| `No interview for <date>. Run: node loop.js ask` | Run `ask` before `sync`. |

---

## Architecture & roadmap

- **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** — the two seams (provider + connectors), the data flow, and how each component fits.
- **[PLAN.md](PLAN.md)** — design decisions and what's next (instructor reports, scheduled triggers, Google Drive input, multi-user).

## License

[MIT](LICENSE).
