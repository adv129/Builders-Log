/*
 * Builder Log Agent — Onboarding templates.
 *
 * INSTRUCTOR_QUESTIONS  — the 6 questions asked of the instructor to calibrate
 *                         the "For your instructor" triage section.
 * instructorDoc(cfg)    — generates the full INSTRUCTOR_ONBOARDING.md document
 *                         text to share with the instructor.
 *
 * Ported from onboard.js; lives here so it can be imported by the web wizard,
 * the CLI, and tested independently.
 */

"use strict";

const INSTRUCTOR_QUESTIONS = [
  "What do you most want to know about this person's progress each cycle?",
  "What does *real* progress look like to you here — what evidence actually convinces you?",
  "What do you want flagged early (blockers, risks, scope changes, anything else)?",
  "How often, and in what format, do you want updates? (e.g. weekly, short note / doc)",
  "What is NOT useful — what would you rather never see in an update?",
  "Is there a current goal or milestone you're measuring this work against?",
];

/**
 * instructorDoc(cfg) -> string
 *
 * Generate the INSTRUCTOR_ONBOARDING.md content to share with the instructor.
 * cfg is the loaded config.json (may be null/undefined if called before setup).
 */
function instructorDoc(cfg) {
  const builder = cfg?.builder?.name || "the builder";
  const project = cfg?.builder?.project ? ` (${cfg.builder.project})` : "";
  const instructorName = cfg?.instructor?.name || "the instructor";
  const qs = INSTRUCTOR_QUESTIONS
    .map((q, i) => `${i + 1}. ${q}\n\n   > _your answer_\n`)
    .join("\n");

  return (
    `# Builder Log — quick setup (for ${instructorName})\n\n` +
    `${builder} is piloting a tool that keeps a disciplined log of their work${project} and\n` +
    `sends you a short, signal-only update. So it surfaces what *you* actually want — and nothing\n` +
    `you don't — please answer the few questions below in your own words.\n\n` +
    `---\n\n${qs}\n---\n\nThat's it. Send it back and the updates will be shaped around these answers.\n`
  );
}

/**
 * extractInstructorPrefs({ thesis, questions, reply }) -> string
 *
 * STRICT-JSON prompt that maps an instructor's free-text answer to the
 * calibration questions into the structured preference fields the triage layer
 * uses. This is what turns a Slack reply into real (non-default) preferences —
 * the missing return leg of mentor calibration.
 */
function extractInstructorPrefs({ thesis, questions, reply }) {
  const qList = (questions || INSTRUCTOR_QUESTIONS).map((q, i) => `${i + 1}. ${q}`).join("\n");
  return (
    `${thesis}\n\n` +
    `An instructor answered the calibration questions below in their own words. Map their ` +
    `answer into preferences for shaping future updates to this builder. Output STRICT JSON ` +
    `only — no prose, no code fence — with EXACTLY these keys:\n` +
    `{\n` +
    `  "caresAbout": ["<what they most want to know each cycle>"],\n` +
    `  "wantsFlaggedEarly": ["<what to surface early: blockers, risks, scope changes>"],\n` +
    `  "cadence": "<how often they want updates, e.g. weekly or daily>",\n` +
    `  "format": "<preferred format, e.g. short bullets>",\n` +
    `  "notUseful": "<what they never want to see>",\n` +
    `  "currentGoal": "<the goal or milestone this work is measured against, if stated>"\n` +
    `}\n` +
    `Use ONLY what the instructor actually said — leave a string "" or an array [] if they ` +
    `didn't address it. Never invent preferences.\n\n` +
    `CALIBRATION QUESTIONS:\n${qList}\n\n` +
    `INSTRUCTOR'S REPLY:\n${reply || "(no reply)"}\n`
  );
}

module.exports = { INSTRUCTOR_QUESTIONS, instructorDoc, extractInstructorPrefs };
