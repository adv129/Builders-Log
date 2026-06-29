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

module.exports = { INSTRUCTOR_QUESTIONS, instructorDoc };
