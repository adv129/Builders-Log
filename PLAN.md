# Builder Log Agent — Plan

A **provider-agnostic agent framework** for student↔mentor guidance. A student plugs in
their own LLM backend; the agent gets context on their work, chats with them about it at
checkpoints, and surfaces to a mentor *only* the few things that truly need them — giving
the student guidance and the mentor a high-fidelity, low-noise feed.

Guiding rule (carried from v1): **Record, don't dictate. Evidence over activity. Flag AI over-reliance.**

## Architecture — two seams around a vendor-neutral core

```
          (trigger: checkpoint / cron / external event / manual)
                              │
        ┌─────────────────────▼────────────────────────┐
        │                  CORE LOOP                      │
        │  observe → interview → synthesize →             │
        │  triage → report → fold-in                      │
        │  owns: state + raw/derived storage              │
        └──────┬───────────────────────────────┬─────────┘
               │                               │
       PROVIDER seam                    CONNECTOR seam
       (the brain)                      (senses + mouth)
     ┌────┼────┐                     ┌─────┼──────┐
  claude-p codex OpenRouter       Slack  terminal  Drive
```

- **Provider seam** — one interface, `complete(prompt) → text`, with swappable adapters:
  `claude -p` (Claude subscription, no API key), Codex headless, or an API key (OpenRouter).
  The framework **owns all orchestration** so that even a raw text-in/text-out API works —
  it never relies on a provider's built-in tools.
- **Connector seam** — where work comes *in* and chat goes *out*: Slack, terminal, Drive.
  Each normalizes its data into the common RAW format; the loop is surface-agnostic.
- **Core loop** — vendor-neutral and surface-neutral. Names no provider, no surface.

## Runtime — trigger-based, NOT an always-on service

The agent wakes on a trigger, reads everything new since `lastRun`, acts, and exits.
Triggers: a scheduled checkpoint (daily cron), an external event (webhook / Slack
slash-command / button), or a manual run. No persistent daemon, no held socket.

Consequence: **every input is "the delta since lastRun"** — changed work files, new Slack
messages, new instructor replies. Conversations are turn-based across triggers.

## The three input modes

| Mode | Kind | Source |
|---|---|---|
| **WORK** | objective — what was produced | git commits (richest) → file deltas (fallback). Drive later. |
| **CONVERSATION** | subjective — the thinking | the checkpoint interview (terminal now → Slack later) |
| **INSTRUCTOR** | external — what to optimize for + feedback | onboarding prefs + an ongoing reply thread |

Possible later inputs: student's AI-tool logs (cleanest friction signal, but sensitive);
a one-line self-report. The agent's own past outputs are **memory**, not a new input.

## Storage — separate RAW from DERIVED

- **RAW** = the three input streams, captured verbatim, append-only, never rewritten.
- **DERIVED** = everything we synthesize and can regenerate from raw (log entries,
  commitments, triage, reports). Re-derive when synthesis improves; raw is the audit trail.
- **Don't copy durable artifacts** (code/docs live in the repo/Drive) — store a pointer,
  a one-line summary, and a content **hash** (truer than mtime).

```
agent-dir/
  config.json              # one-time setup (provider, watch paths, builder, instructor prefs)
  state.json               # DERIVED running state: file snapshot, OPEN commitments, blockers
  raw/
    work/2026-06-25.json       # day's delta: pointers + per-file summary + hash
    chat/2026-06-25.md         # interview transcript, verbatim
    instructor/thread.jsonl    # append-only: {date, direction, text}
  log/2026-06-25.md            # DERIVED: synthesized Builder Log entry
  reports/week-04.md           # DERIVED: instructor report
```

Technique: **hybrid flat files** — Markdown for human-facing narrative, JSON/JSONL for
structured/queryable state. SQLite only if a whole cohort forces cross-builder queries.
Design storage with a `builderId` namespace early so multi-tenant is config, not a rewrite.

## Decisions (locked)

| Fork | Choice |
|---|---|
| Provider | Pluggable `complete()` seam; **`claude -p` first**, codex/OpenRouter as later adapters |
| Sequencing | **Prove the loop locally first**, then add Slack |
| Runtime | **Trigger-based** (checkpoint / cron / external / manual) — no always-on daemon |
| Chat surface | Terminal first → Slack (trigger-based) later |
| Work signal | git when available, file-snapshot fallback; content hash over mtime |
| Instructor | **triage-gated** — only the 1–3 highest-value items reach them (review-before-send is an open question once Slack is live) |
| Storage | Hybrid flat files (md + json/jsonl), raw vs derived split, builderId-namespaced |

## Phases

- **Phase 0 — scaffold:** `observe.js` + `state.json` + `log/`. ✓
- **Phase 1 — Onboarding:** `config.json` + `onboard.js` + `INSTRUCTOR_ONBOARDING.md`. ✓
- **Phase 2 — Provider seam + core loop (local):** `provider.js` (`complete()` + claude-p adapter);
  `loop.js ask`/`sync`; raw/derived storage. ✓
- **Phase 3 — Memory + triage:** `track.js` — first-class commitments (resolve/carry/dedupe),
  accumulated as structured DATA. **The deterministic flag layer (`computeFlags`) was removed** —
  significance/triage is now JUDGED BY THE LLM from a `historyView` projection + instructor prefs, so
  it generalizes (no baked thresholds). `loop.js status` prints facts only. ✓
- **Phase 5 — Slack connector:** `connectors/slack.js` (openDm/postMessage/historySince/sendToUser);
  `loop.js` dispatches on `config.chatSurface` — `ask` DMs the student, `sync` reads replies as a delta
  and folds in instructor replies; instructor note is **gated** (`send-instructor` posts it). Terminal
  path preserved. Trigger runtime (cron/webhook) still TODO. ✓
- **Phase 6 — More providers:** OpenRouter (API key, env `OPENROUTER_API_KEY`) + Codex (`codex exec`)
  adapters behind `complete()`. ✓ (Codex unverified on this machine — CLI not installed.)
- **Phase 4 — Instructor report:** derived from accumulated triage, shaped by their stated prefs. ← *next*
- **Later:** trigger runtime, Drive input, multi-tenant `builderId` namespacing.
- **Setup UX (next track, after functionality):** make first-run dead simple — an interactive
  `node setup` wizard (provider pick, watch folder, Slack token + user IDs, mentor onboarding),
  config validation with friendly errors, and a guided Slack-app creation flow.

## Current files
Core: `provider.js` (claude-p · codex · openrouter) · `loop.js` (ask/sync/status/send-instructor) ·
`observe.js` (delta) · `track.js` (memory + `historyView`) · `onboard.js` (setup) ·
`connectors/slack.js` (Slack I/O)
State: `config.json` (+ provider models, `chatSurface`, `slack`) · `state.json` (+ `slack` cursor) ·
`raw/{work,chat,instructor}/` · `log/` · `reports/`
Other: `INSTRUCTOR_ONBOARDING.md` · `demo_project/` (sample, safe to delete) · `builder-log-agent.js` (v1)

## Secrets / env
`OPENROUTER_API_KEY` (if provider=openrouter) · `SLACK_BOT_TOKEN` (if chatSurface=slack;
scopes chat:write, im:write, im:history) · `SLACK_API_BASE` (tests only).
