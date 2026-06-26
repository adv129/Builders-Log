# Architecture

Builders Log is a small, vendor-neutral core wrapped by two swappable "seams." This doc explains how the pieces fit so you can read the code or extend it confidently.

## The big picture — two seams around a neutral core

```
                          TRIGGER
         (today: you run it · later: cron · webhook · Slack)
                             │
                             ▼
   ┌───────────────────────────────────────────────────────────┐
   │                    CORE LOOP   (loop.js)                    │
   │       ask  →  [you answer]  →  sync      (+ status)         │
   │   vendor-neutral · surface-neutral · owns all orchestration │
   └────┬──────────────────────┬───────────────────────┬────────┘
        │                      │                        │
   reads WORK             calls the BRAIN          reads/writes
   (observe.js)           (provider.js)             STORAGE
        │                      │                        │
        ▼                      ▼                        ▼
  file deltas under     complete(prompt)→text     config.json · state.json
  config.root           ┌──────┼───────┐          raw/ (verbatim) · log/ (derived)
                    claude-p  codex  openrouter
```

Two swap points:

- **Provider seam** (`provider.js`) — the only thing the loop needs from an LLM is `complete(prompt) → text`. Adapters: `claude-p` (Claude Code login, no key), `codex` (`codex exec`), `openrouter` (any model via API key). Switch with one line in `config.json`.
- **Connector seam** — where work comes in and chat goes out. Work input is local files (`observe.js`); chat is the terminal or Slack (`connectors/slack.js`), chosen by `config.chatSurface`.

The **core loop never names a vendor or a surface** — that's what makes this a framework rather than a script.

## The daily flow (two phases)

The loop is split into two steps on purpose, so the *same shape* works in the terminal and in Slack (questions go out on one trigger; answers come back as a delta on the next):

```
STEP 1 — ask                                            (trigger #1)
  observe.snapshot(root)  vs  state.files ──delta?──no──▶ "nothing to ask"
        │ yes
        ▼
  read the changed files (truncated)
        │
        ▼
  provider.complete( thesis + "ask 3–5 grounded questions" + open commitments + file excerpts )
        │
        ├──▶ raw/work/DATE.json     RAW: the delta (new/modified/deleted + excerpts)
        └──▶ raw/chat/DATE.md       RAW: the questions (+ blank answer slots, or DM'd via Slack)
                       │
                       ▼
            ┌──────────────────────────┐
            │  YOU answer               │   ← terminal file, or Slack DM
            └──────────────────────────┘
                       │
STEP 2 — sync                                           (trigger #2)
                       ▼
  read answers (file or Slack)  +  raw/work/DATE.json
                       │
        (A) EXTRACT ─ provider.complete(→ STRICT JSON: resolved / newCommitments / blockers)
                       │
        (B) MEMORY ─ track.applyExtraction + bumpChurn ──▶ updates state.json
                       │     resolve-with-evidence · carry forward · dedupe re-commits
                       ▼
        (C) SYNTH ─ provider.complete(
                       thesis + 3-section contract
                       + HISTORY CONTEXT (track.historyView) + instructor prefs
                       + work delta + your answers )
                       │
                       ├──▶ log/DATE.md     DERIVED: Builder Log · For-your-instructor (triage) · Friction check
                       └──▶ state.json      commit snapshot + lastRun + commitments
```

### Significance is judged, not hardcoded

Earlier versions computed "stalls" with fixed thresholds (open ≥ 3 days, etc.). That doesn't generalize across contexts, so it was removed. Now `track.historyView()` projects the accumulated memory into **plain facts** (each open commitment's age + carried count + whether it has evidence, blockers with counts, file churn), and the synthesis prompt hands those facts to the LLM with instruction to **judge** what's stalling and what deserves the mentor's attention — using the trajectory and what the mentor said they care about. No baked-in numbers.

## Components

| File | Responsibility |
|---|---|
| `loop.js` | Orchestrates `ask` / `sync` / `status` / `send-instructor`; holds the prompts; writes the raw/derived split. |
| `provider.js` | `complete(prompt, opts)` → text. Dispatches to the configured adapter. Adapters receive `opts.config` for model settings; secrets come from env. |
| `observe.js` | `snapshot(root)` → `{path: mtime}`, `diff(prev, curr)` → `{added, modified, deleted}`. Ignores `node_modules/.git/.DS_Store` always, and the agent's own files only when it's watching its own folder. |
| `track.js` | Pure memory functions: `applyExtraction` (resolve/carry/dedupe commitments, blocker recurrence), `bumpChurn`, and `historyView` (read-only factual projection). No judgment, no thresholds. |
| `onboard.js` | Setup + validation (`--check`/`--summary`) and the mentor questionnaire (`--instructor-doc`). |
| `connectors/slack.js` | `openDm` / `postMessage` / `historySince` / `sendToUser`. Reads replies as a delta since a stored timestamp; filters out the bot's own messages. |

## Storage model — RAW vs DERIVED

- **RAW** (`raw/work`, `raw/chat`, `raw/instructor`): inputs captured verbatim, append-only, never rewritten. This is the audit trail behind every "evidence, not activity" claim.
- **DERIVED** (`log/`, `reports/`, and the computed parts of `state.json`): synthesized output that can be regenerated from RAW. If the synthesis prompts improve, you can re-derive history instead of losing it.
- **Don't copy durable artifacts**: your code and docs already live in your project folder, so the agent stores only pointers, short excerpts, and a snapshot for change detection — not copies.

## Extending it

- **A new model backend**: add an adapter function to `provider.js` and register it in `ADAPTERS`. It just needs to take a prompt string and return text.
- **A new work-input source** (e.g. Google Drive, git commits): produce the same delta shape `observe.js` does, and feed it into `ask`.
- **A new chat surface**: mirror `connectors/slack.js` (send a message, read messages since a timestamp) and branch on `config.chatSurface`.

See [PLAN.md](../PLAN.md) for the roadmap.
