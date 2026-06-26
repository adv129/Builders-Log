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
const { askQuestions } = require("./ask");
const { extractFacts } = require("./extract");
const { synthesizeEntry } = require("./synthesize");
const { INSTRUCTOR_QUESTIONS, instructorDoc } = require("./onboard");

module.exports = {
  THESIS,
  askQuestions,
  extractFacts,
  synthesizeEntry,
  INSTRUCTOR_QUESTIONS,
  instructorDoc,
};
