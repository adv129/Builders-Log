# Builders Log — Remake Plan

> Status: **proposal awaiting final approval.** No code changed yet. Branch: `testing`.

## Goal

Rebuild Builders Log so a non-technical builder runs **one command** and then lives in a **simple local web app** — onboarding, check-ins, history, settings — with the terminal barely involved. Keep the proven agent loop and thesis; adopt the clean design patterns from [codojo](https://github.com/jasonnoble/codojo).

## Decisions (locked)

| Decision | Choice |
|---|---|
| Language | **JavaScript**, zero-dependency, Node's built-in `node:test` for tests. No build step. |
| Approach | **Greenfield rewrite** — fresh `src/` + `public/` structure; port the *proven* logic (provider adapters, observe diff, track memory, prompt text) into the new shape; retire the old root files. |
| Primary surface | **Web app** — the main way the builder interacts with the agent; **check-ins happen here**. |

## Surfaces & their roles (important)

- **Web app — primary.** Onboarding, the check-in (ask → answer → entry), history, and settings all happen in the browser. This is where students do their check-ins now (not Slack).
- **Terminal — minimal.** Ideally just `npm start`. No required terminal interaction for daily use after setup. (CLI commands stay available for power users / automation, but are not the path we document first.)
- **Slack — reminders + delivery now, full operation later.**
  - Now: DM the builder a **reminder** to do their check-in (with a link to the web app), and deliver the **instructor note**.
  - Future: optionally operate the whole check-in through Slack. We keep the connector and the delta-reply mechanism so that future is cheap.
  - This means Slack is no longer the student's *answer* channel — that moves to the web app.

## What we keep (proven, port forward)

- The two-phase **ask → answer → sync** loop and the thesis: *record don't dictate, evidence over activity, LLM-judged triage* (no hardcoded thresholds).
- The **provider seam** (`complete()` → claude-p / codex / openrouter), with Retry-After backoff.
- The **RAW vs DERIVED** storage split (`raw/`, `log/`, `state.json`) and `config.json` shape (incl. labeled instructor **defaults**).
- The **Slack connector** primitives (open DM, post, read-since) — repurposed for reminders + instructor delivery.

## What we adopt from codojo

1. **Clean layering**: thin entry → core modules → small **pure, testable helpers**. Set `process.exitCode`, never `process.exit` in logic.
2. **Prompts-as-functions** in a `templates/` dir behind a **manifest**, with prompt wording **unit-tested**.
3. **Onboarding = confirm-back interview** gated by an `onboarded` flag; one topic at a time, confirm before writing the user's own record; **don't ask for inputs you can't consume**; background/context first.
4. **Never-clobber guards** + **idempotent re-runs** (we're a daily tool — must re-run safely).
5. A lightweight **`CONSTITUTION.md`** (non-negotiables + fixed stack) and dated **research notes** on `claude -p` / `codex exec` behavior.
6. A real **`node:test`** suite (zero-dep).

> Caveat: codojo never shells out to Claude (it scaffolds a workspace Claude runs in); we drive `claude -p` ourselves and are provider-agnostic. We take their structure, prompt-as-files, onboarding discipline, and testing — not their runtime model.

## Architecture

- **`core.js`** — surface-agnostic engine: `runAsk(cfg,state)` / `runSync(cfg,state,answers)` / `statusView(cfg,state)`, returning **structured data** (no printing, no Slack inside). Every surface (web, CLI, future Slack) calls this.
- **`server.js`** — plain Node `http` (zero deps), bound to **127.0.0.1**, auto-opens the browser, free-port fallback (default 4178), serves the SPA + a small JSON API.
- **`public/`** — vanilla SPA, four screens:
  1. **Onboarding wizard** — provider pick, **folder picker** (no typing absolute paths), builder info, instructor name + editable default prefs.
  2. **Check-in** — the two-phase loop as one smooth flow: *Start* → answer grounded questions inline → *Generate* → entry + gated instructor draft + memory summary.
  3. **History & status** — past logs (rendered markdown) + open commitments / blockers / churn.
  4. **Settings** — change provider, folder, builder, instructor prefs, and Slack reminder settings anytime.
- **`templates/`** — prompts as functions + manifest (interview, extract, synthesize, triage, onboarding).
- **`connectors/slack.js`** — reminders (DM + link) and instructor-note delivery; reply-reading kept for the future full-Slack mode.
- **Reminders** — a `sendReminder` path the builder can trigger or schedule (cron / future trigger runtime) to DM themselves "time for your check-in → <link>".

## Proposed structure

```
src/
  cli.js              minimal dispatch (serve, + power-user ask/sync/status)
  core.js             runAsk / runSync / statusView + shared helpers
  server.js           local web server (http + static + JSON API)
  provider.js         complete() seam
  observe.js  track.js
  onboard.js          onboarding logic + instructor questionnaire
  connectors/slack.js reminders + instructor delivery
  templates/          prompts as functions + manifest
public/               index.html, app.js, style.css (the SPA)
test/                 node:test suites
docs/                 ARCHITECTURE.md, CONSTITUTION.md, research/
```
Data files (`config.json`, `state.json`, `raw/`, `log/`, `reports/`) keep today's shapes — **no schema break**, existing data still loads.

## Onboarding overhaul

- **Builder onboarding** in the web wizard (folder picker, provider, builder info), confirm-before-write, **resumable** (improve on codojo's restart-from-top).
- **Instructor onboarding — close the gap**: today the instructor is never actually asked. Add: a UI step to share the questionnaire + paste answers back, and (optional) a Slack DM that asks the 6 questions and reads replies → writes `config.instructor` and sets `preferencesSource: "instructor"`.
- **Defaults stay labeled** (`preferencesSource: "default"`) until overridden.

## Phased build order (greenfield, each phase runnable)

1. **`core.js`** — port ask/sync/status logic into structured functions; a tiny smoke test that it still produces an entry (claude-p).
2. **`templates/`** — extract all prompts into tested functions behind a manifest.
3. **Server skeleton** — `server.js`, static serving, `npm start`, auto-open, `/api/status` + `/api/config`.
4. **Check-in flow** — `/api/ask` + `/api/sync` + the Check-in screen (highest-value path; student can complete a full cycle in the browser).
5. **Onboarding wizard + settings + folder picker**; instructor onboarding.
6. **History screen** + status panel.
7. **Slack reminders** — DM-with-link + instructor-note delivery; settings to configure.
8. **Hardening** — `node:test` suite, never-clobber guards, idempotency, `CONSTITUTION.md`, `research/` notes, README "Web app" quick-start. Retire superseded root files.

## Risks

- **Greenfield regression** — port proven logic verbatim where possible; keep a claude-p smoke test from Phase 1 on.
- **Secrets in a browser world** — claude-p needs no key (default); OpenRouter/Slack tokens go to the git-ignored `.env`, never `config.json`.
- **Long LLM calls** (10–30s, no streaming from `claude -p`) — spinner now, optional SSE coarse-progress later.
- **Reminders need scheduling** — true "remind me" wants a cron/trigger; v1 can be a manual "send reminder" button + documented cron, with the trigger runtime as a later phase.
