/*
 * Builder Log Agent — Templates manifest.
 *
 * Single import point for all prompt templates. Surfaces (web, CLI) and tests
 * import from here so individual template files can be reorganised without
 * changing call sites.
 *
 * Re-exports:
 *   THESIS                — standing identity preamble prepended to all LLM calls
 *   askQuestions(opts)    — interview question prompt (Phase 1 / runAsk)
 *   extractFacts(opts)    — STRICT-JSON extraction prompt (Phase 2A / runSync)
 *   synthesizeEntry(opts) — 3-section entry prompt (Phase 2C / runSync)
 *   INSTRUCTOR_QUESTIONS  — array of 6 instructor onboarding questions
 *   instructorDoc(cfg)    — full INSTRUCTOR_ONBOARDING.md text generator
 */

"use strict";

const { THESIS } = require("./thesis");
const { askQuestions, DEFAULT_ASK_GUIDANCE } = require("./ask");
const { extractFacts } = require("./extract");
const { synthesizeEntry } = require("./synthesize");
const { INSTRUCTOR_QUESTIONS, instructorDoc, extractInstructorPrefs } = require("./onboard");
const { PROJECT_PLAN_FORMAT, projectPlanPrompt } = require("./projectPlan");
const { suggestObjectives } = require("./priorities");

// Default text for the user-editable prompts (Settings → Prompts). The UI reads
// these to pre-fill the editors and power "Reset to default". Anything NOT
// listed here — the extraction JSON schema, output formats, section headers —
// is intentionally fixed in code and not user-editable.
const PROMPT_DEFAULTS = {
  thesis: THESIS,
  askGuidance: DEFAULT_ASK_GUIDANCE,
  synthesisGuidance: "",
};

module.exports = {
  THESIS,
  askQuestions,
  extractFacts,
  synthesizeEntry,
  INSTRUCTOR_QUESTIONS,
  instructorDoc,
  extractInstructorPrefs,
  PROJECT_PLAN_FORMAT,
  projectPlanPrompt,
  suggestObjectives,
  DEFAULT_ASK_GUIDANCE,
  PROMPT_DEFAULTS,
};
