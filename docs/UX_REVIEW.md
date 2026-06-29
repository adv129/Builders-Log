# UX Review — does the Builder Log actually help a student sync with their mentor?

_Reviewed: 2026-06-29 · Branch: `ux_overhaul`_

> **Update (post-review, per feedback):** two of the fixes below were rolled back.
> The **History "This week so far" + "Shared with your mentor" panels (Theme 6)** were
> removed — the weekly trajectory already lives on the Check-in screen, and History stays
> the project plan + past entries. The **Slack mentor-calibration round-trip (Theme 4)** was
> removed in favor of a simple **Copy questionnaire** in Settings → Instructor (no auto-ingest).
> The new check-in panels (mentor context, "This week" lists) were also **restyled** to match
> the app's white-card / ink-border language (no tan-on-tan, readable type). Everything else
> below stands.

This is a full walk of the experience against one job-to-be-done:

> **A student/intern keeps a log of building a project, and that log helps them _sync_ with their mentor.**

"Sync" is the operative word. It is **two-directional**: the student pushes signal up
(here's where I am, here's what I'm stuck on, here's what I need), and the mentor pushes
guidance down (priorities, answers, feedback, unblocking). The log is the shared
artifact that keeps both sides on the same page over weeks.

The engine and the **quality of the generated artifacts are genuinely strong** — the log
entries are sharp, evidence-driven, and the instructor triage is excellent (see
`log/2026-06-25.md` and `log/2026-06-29.md`). The problems are almost entirely in the
**experience around** the engine, and they cluster on the mentor side of "sync."

---

## TL;DR — the sync loop is half-built

The student → mentor direction works (you can draft and send a note). The
**mentor → student direction barely exists**, and several everyday capture cases dead-end:

1. **The loop is one-way.** A note goes out over Slack; the mentor's reply never comes
   back into the app or the log. `collectInstructorAnswers()` exists but is wired to nothing.
2. **The mentor never actually calibrates the agent.** The student _guesses_ the mentor's
   preferences during onboarding. The real questionnaire can be copied to clipboard, but
   there's no in-app round-trip to send it and ingest the answers — so triage often runs on
   `preferencesSource: "default"`, which the agent itself flags as degraded.
3. **You can't log non-file work.** No file change → "No new work since your last check-in"
   → dead end. But a huge share of build progress is meetings, decisions, getting stuck,
   talking to users. The tool's own best entries are mostly _thinking_, not diffs.
4. **The student can't edit what gets sent to their mentor.** The instructor note is
   render-only; you send-as-is or not at all. For a tool whose thesis is "RECORD, DON'T
   DICTATE," the student has zero agency over the outbound message.
5. **The mentor is invisible while you work.** Their current goal and whether they've even
   calibrated never appear on the check-in screen.
6. **The log header is noise.** A real entry lists 36 changed files including
   `package-lock.json`, `favicon.ico`, `tsconfig.tsbuildinfo`, and `.svg` assets — and those
   same files burn the prompt's context budget.
7. **History has no arc.** It's a flat list of date buttons + the project plan. The
   trajectory that mentorship needs — what's still open, what keeps recurring, what was
   escalated and what the mentor said — is invisible.

---

## The journey, stage by stage

### 1) Onboarding

**Finding 1.1 — The mentor calibrates nothing; the student guesses for them.**
Step 4 ("Instructor") asks the _student_: "What does your instructor care most about?",
"What should be flagged early?", etc. The student is guessing on the mentor's behalf. There
is a "Generate questionnaire to send my mentor" button that produces a nice markdown doc,
but nothing sends it and nothing ingests the answer. The mentor's real preferences are the
single biggest input to triage quality (`preferencesSource` gates a "these are DEFAULTS"
warning injected into every synthesis), and the flow to collect them for real is missing.
_Severity: high — this is the core of "sync with your mentor."_

**Finding 1.2 — Slack (the mentor channel) is never set up during setup.**
Onboarding goes Provider → Folder → Builder → Instructor → Review → Project plan. Slack —
the only channel that actually reaches the mentor — is configured separately in Settings.
A user can complete the entire wizard and have **no connection to their mentor at all**,
which is invisible until they go hunting in Settings. The "instructor" they named in step 4
is never linked to a real human.

**Finding 1.3 — The questionnaire has no "how do I get the answers back?" path.**
Even if the student copies the markdown and sends it, the only way the answers re-enter the
app is hand-transcription into Settings fields. No round-trip.

### 2) The daily check-in

**Finding 2.1 — No file change = no check-in (hard dead end).**
`runAsk` short-circuits to `{changed:false}` and the UI shows "No new work since your last
check-in. Edit something in your project folder and try again." This mismatches reality:
build progress is frequently a decision, a meeting with the mentor, a user conversation, a
day spent stuck. The tool can't capture any of it unless a file's mtime moved.
_Severity: high — it silently excludes the work mentors most want to hear about._

**Finding 2.2 — The student can't edit the generated entry or the instructor note.**
Both render as read-only markdown. The instructor note especially — the thing that goes to a
real person — can only be sent verbatim or not sent. The friction-check can be wrong or read
as accusatory, and the student can't soften, correct, or add context before it ships.
_Severity: high — agency + trust._

**Finding 2.3 — "Files changed" dumps everything.**
`log/2026-06-29.md` header lists 36 files: `package-lock.json`, `next-env.d.ts`,
`favicon.ico`, `apple-icon.png`, four `.svg`s, `tsconfig.tsbuildinfo`, etc. `observe.js`
ignores only `node_modules` / `.git` / dotfiles / `.DS_Store`. Lockfiles, build output, and
binaries flow straight into both the log header _and_ the LLM prompt (a 4000-char excerpt of
`package-lock.json` adds nothing and crowds out real code).
_Severity: medium — pollutes signal and wastes context budget._

**Finding 2.4 — In-progress answers are lost on reload.**
Questions persist server-side (`raw/chat/<date>.md`), but typed answers live only in DOM
state until "Generate entry." A refresh loses them. No skip/"not sure" affordance either.
_Severity: low–medium._

### 3) The mentor sync (the heart of the tool)

**Finding 3.1 — Delivery is fire-and-forget; the reply never returns.**
`sendInstructorNote` DMs the note and says "Reply here if you have feedback" — but nothing
ever reads that reply. The mentor's guidance lives in Slack, disconnected from the log entry
that prompted it. `state.instructorThread` (which `buildHistoryContext` _does_ read into
every synthesis) is **never populated**, so the agent never learns from anything the mentor
said. This is the single biggest "sync" gap.
_Severity: high._

**Finding 3.2 — The mentor experiences disconnected bot pings.**
Two unrelated flows hit the mentor: "set this week's priorities" and "here's an update."
There's no coherent thread, no shared context. The note carries bullets and nothing else —
no link to the fuller log, the plan, or history.

**Finding 3.3 — The mentor's goal is invisible to the student mid-work.**
`instructor.currentGoal` is collected and fed to prompts but never _shown_. The "This week"
panel lists objectives but not the overarching thing the student is syncing toward, nor the
mentor's name, nor whether the mentor has calibrated at all.
_Severity: medium._

### 4) History & continuity

**Finding 4.1 — No trajectory.** History = date buttons + the current project plan. The
engine computes rich memory (carried commitments, blocker recurrence counts, churn) and the
weekly plan tracks objectives/progress/blockers — but the web UI shows none of the arc.
You click one date and read one entry. Mentorship is about the line over time, not points.

**Finding 4.2 — No record of what was shared with the mentor.** You can't see which notes
were sent vs. just drafted, when, or whether the mentor replied. The "what have we synced
on?" view doesn't exist.

**Finding 4.3 — Past weekly plans aren't browsable** except via a raw Settings textarea for
the current week.

### 5) Cohesion, IA, robustness

**Finding 5.1 — The mentor relationship is scattered.** Pieces live in Onboarding (name +
guessed prefs), Settings (Slack IDs, prefs editing, plans), and the check-in (weekly
priorities ask). There's no single "Mentor" home, so the relationship never feels like one
thing.

**Finding 5.2 — Duplicated send→sync state machines.** The daily check-in and weekly
priorities each reimplement "button label flips to Sync," "armed warning auto-clears after
5s," and awaiting-state resume. Works, but it's drift-prone.

**Finding 5.3 — Dead/vestigial code creates confusion.** `track.applyExtraction` expects an
old schema (`resolved` / `newCommitments`) that the current `extractFacts` prompt no longer
emits (`progress` / `resolvedObjectives` / …); `runSync` no longer calls it. `statusView`
+ `/api/status` + CLI `status` still report `state.commitments`, which the live flow never
populates — so they always read empty. _Not user-facing today, but it misleads maintainers._

**Finding 5.4 — Raw provider errors leak to users.** "claude exited with code 1" surfaces
verbatim in the UI. Opaque for a non-technical student.

**Finding 5.5 — Cadence is dead.** `instructor.cadence` (daily/weekly) is collected but
nothing reminds anyone. `/api/reminder` + `sendReminder` exist but no UI triggers them and
there's no scheduler (the app isn't always-on — a true scheduler is out of scope for a
local-first tool, so this should at least be honest/manual rather than implied).

---

## What I'm fixing in this pass (priority order)

Constraints respected throughout: zero runtime deps, local-first, secrets from env, the
markdown-first plan model, and the existing test contracts.

| # | Theme | Findings addressed |
|---|---|---|
| 1 | **Non-file ("reflective") check-in** — log meetings/decisions/thinking even with no diff | 2.1 |
| 2 | **Cut noise from the delta + log header** — ignore lockfiles/build/binaries; summarize the header | 2.3 |
| 3 | **Editable instructor note + reply ingestion** — edit before send; pull the mentor's reply back into the app and into `instructorThread` so it informs future synthesis | 2.2, 3.1, 3.2 |
| 4 | **In-app mentor calibration round-trip** — send the questionnaire over Slack and ingest the reply, LLM-mapped to real preferences | 1.1, 1.3 |
| 5 | **Keep the mentor visible** — mentor name + current goal on the check-in; nudge when prefs are still default | 1.2, 3.3 |
| 6 | **History trajectory + shared-with-mentor record** — open items, recurring blockers, what was escalated & whether the mentor replied | 4.1, 4.2 |

**Consciously deferred (with reason):**
- A true reminder _scheduler_ (5.5) — conflicts with local-first / not-always-on. Kept manual + honest.
- A mentor-facing web view (3.2) — would break the 127.0.0.1 single-user / local-first model.
- Refactoring the duplicated state machines (5.2) and removing vestigial commitments code
  (5.3) — internal cleanups, not user-facing; noted for a follow-up so this pass stays focused on UX.
- Answer autosave on reload (2.4) — lower severity; revisit if it bites.
