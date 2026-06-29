# Architecture

Builder Log is a surface-agnostic engine wrapped by three thin surfaces. This document explains how the pieces fit so you can read the code or extend it confidently.

## The big picture

```
                   TRIGGER
     (user clicks in web app · npm script · future cron)
                        │
                        ▼
  ┌────────────────────────────────────────────────────────┐
  │               ENGINE  (src/core.js)                    │
  │        runAsk  →  [builder answers]  →  runSync        │
  │   surface-agnostic · no console.log · no Slack inside  │
  └──────┬──────────────────────┬──────────────────────────┘
         │                      │
    reads WORK              calls the BRAIN           reads/writes
    (src/observe.js)        (src/provider.js)         STORAGE
         │                      │                          │
         ▼                      ▼                          ▼
   file deltas under     complete(prompt)→text      config.json · state.json
   config.root           ┌──────┼───────┐           raw/ (verbatim) · log/ (derived)
                     claude-p  codex  openrouter
```

## Three surfaces — one engine

The engine (`src/core.js`) is called by three thin surfaces. Each surface handles its own I/O and calls the engine functions to do the real work:

| Surface | File | What it does |
|---|---|---|
| **Web app** (primary) | `src/server.js` | Zero-dep Node `http` server, bound to 127.0.0.1. Serves the SPA (`public/`) and a small JSON API. The browser is where builders do check-ins, see history, and change settings. |
| **CLI** (power users) | `src/cli.js` | Minimal terminal wrapper. `ask` / `sync` / `status`. Reads answers from `raw/chat/<date>.md`. Kept tiny — no logic. |
| **Slack** (reminders + delivery) | `src/slack-actions.js` + `src/connectors/slack.js` | DM the builder a reminder link; DM the instructor note after a check-in. Future: full check-in via Slack DM. |

## The two-phase daily flow

The loop is intentionally split so the same shape works in the browser today and via Slack in the future:

```
PHASE 1 — runAsk(cfg, state, {allowEmpty})                (trigger: click / npm run ask)
  observe.snapshot(root)  vs  state.files ──no delta──▶ {changed:false}
        │                                                 (unless allowEmpty: a
        │ delta                                            REFLECTION check-in —
        │                                                  meetings/decisions/stuck)
        ▼
  read changed files (excerpts, up to 4000 chars each)
        │
        ▼
  provider.complete( THESIS + "ask 3-5 grounded questions" + open commitments + file excerpts )
        │
        ├──▶ raw/work/<date>.json     RAW: file delta + excerpts (verbatim)
        └──▶ raw/chat/<date>.md       RAW: questions + blank answer slots

                    ┌──────────────────────────────┐
                    │  Builder answers              │ ← web UI inline / CLI file edit
                    └──────────────────────────────┘
                                  │
PHASE 2 — runSync                                         (trigger: click / npm run sync)
                                  ▼
  read answers + raw/work/<date>.json
                                  │
        (A) EXTRACT ─ provider.complete(→ STRICT JSON: resolved / newCommitments / blockers)
                                  │
        (B) MEMORY ─ track.applyExtraction + bumpChurn ──▶ mutates state in memory
                │     resolve-with-evidence · carry forward · dedupe re-commits
                ▼
        (C) SYNTH ─ provider.complete(
                       THESIS + 3-section contract
                       + historyView (accumulated facts — no pre-judgment)
                       + instructor prefs + work delta + answers)
                                  │
                                  ├──▶ log/<date>.md          DERIVED: the log entry
                                  ├──▶ raw/instructor/<date>.md  RAW: instructor draft
                                  └──▶ state.json             updated commitments + snapshot
```

### Significance is judged, not hardcoded

`track.historyView()` projects accumulated memory into **plain facts** (each open commitment's age + carried count + evidence flag, blockers with counts, file churn). The synthesis prompt passes these raw facts to the LLM with instruction to **judge** significance from the trajectory and what the instructor said they care about. No baked-in day thresholds.

## Components

| File | Responsibility |
|---|---|
| `src/core.js` | Surface-agnostic engine. `runAsk` / `runSync` / `statusView` return structured data and do no I/O to the terminal or Slack. Also exports `loadConfig`, `loadState`, `saveState`, `today`, `ensureDirs`, `ROOT`. |
| `src/server.js` | Zero-dep `http` server. Loads `.env`, serves `public/`, handles JSON API routes (`/api/ask`, `/api/sync`, `/api/status`, `/api/config`, `/api/logs`, `/api/reminder`, `/api/send-instructor`, etc.). Binds to 127.0.0.1 only. |
| `src/cli.js` | Thin terminal surface. `ask` / `sync` / `status` subcommands. Reads/writes only what the terminal needs; delegates all logic to `src/core.js`. |
| `src/provider.js` | `complete(prompt, opts)` → text. Dispatches to the configured adapter. Adapters: `claude-p` (stdin to `claude -p`), `codex` (stdin to `codex exec -`), `openrouter` (HTTPS POST). Secrets from `process.env` only. |
| `src/observe.js` | `snapshot(root)` → `{relPath: mtimeMs}`. `diff(prev, curr)` → `{isFirstRun, added, modified, deleted}`. Ignores `node_modules`, `.git`, dotfiles always; ignores lockfiles, build-output dirs (`dist`/`.next`/…), and binary/generated files (noise filtering, `isNoiseFile`); ignores agent-owned files when watching the agent's own root. |
| `src/track.js` | Pure memory functions: `applyExtraction` (resolve / carry / dedupe commitments, blocker recurrence), `bumpChurn`, `historyView` (read-only factual projection). No judgment, no thresholds. All tested. |
| `src/slack-actions.js` | High-level Slack operations: `sendReminder`, `sendInstructorNote` (accepts an edited note), `collectInstructorFeedback` (mentor's reply to a note), `askInstructor` + `collectInstructorAnswers` (calibration round-trip), `askInstructorObjectives` + `collectObjectiveReplies` (weekly priorities), `sendCheckinQuestions` + `collectCheckinReplies`. Reads config/state; calls the connector; returns structured results. No HTTP, no printing. |
| `src/connectors/slack.js` | Low-level Slack API primitives: `openDm`, `postMessage`, `historySince`, `sendToUser`. Retry-After backoff on HTTP 429. `SLACK_API_BASE` env var for test overriding. |
| `src/templates/` | Prompts as functions behind a manifest (`index.js`). `thesis.js` (THESIS preamble), `ask.js`, `extract.js`, `synthesize.js`, `onboard.js`. Prompt wording is unit-tested in `test/templates.test.js`. |

## Storage model — RAW vs DERIVED

| Category | Path | Properties |
|---|---|---|
| **RAW** | `raw/work/<date>.json` | File delta + excerpts captured verbatim. Append-only. |
| **RAW** | `raw/chat/<date>.md` | Interview transcript (questions + builder's answers). |
| **RAW** | `raw/instructor/<date>.md` | Instructor note drafts (appended each sync). |
| **DERIVED** | `log/<date>.md` | Synthesized Builder Log entry. Overwritten on re-sync. |
| **DERIVED** | `state.json` | File snapshot + commitments + blockers + churn. Owned by `saveState`. |
| **Config** | `config.json` | Setup (root, builder, instructor, provider, Slack). Never contains secrets. |

The agent stores short excerpts and file-mtime snapshots only — never full copies of the builder's project.

## Idempotency and re-run safety

- **`runAsk`:** safe to re-run. If no files changed, returns `{changed:false}` without writing anything. If files changed, overwrites `raw/work/<date>.json` and `raw/chat/<date>.md`.
- **`runSync`:** safe to re-run (same-day). Overwrites `log/<date>.md` (acceptable). On re-run, `applyExtraction` is called again on the already-updated state: resolved commitments stay resolved, open commitments get one more carried increment (not perfectly idempotent but not corrupting), and new commitments dedupe by normalized text. The file snapshot is re-committed after each sync.
- **`saveState`:** writes valid JSON atomically via `writeFileSync`. The config POST handler deep-merges (never clobbers unrelated fields) before writing.

## Extending

- **New model backend:** add an adapter to `src/provider.js` and register it in `ADAPTERS`. It just needs `(prompt, opts) => Promise<string>`.
- **New work-input source** (e.g. git commits): produce the same `{added, modified, deleted}` delta shape that `observe.js` does, and feed it into `runAsk`.
- **New chat surface:** the three-file structure (`raw/work`, `raw/chat`, state) is the contract. Any surface that writes the answers to `raw/chat/<date>.md` and calls `runSync` will work.

## Design principles

See [docs/CONSTITUTION.md](CONSTITUTION.md) for the non-negotiables: zero runtime dependencies, local-first, secrets from env only, provider-agnostic `complete()` seam, record-don't-dictate / evidence-over-activity, web app as primary surface, RAW vs DERIVED split.
