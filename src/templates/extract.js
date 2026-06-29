/*
 * Builder Log Agent — Extraction prompt template.
 *
 * extractFacts({ thesis, date, objectives, chat, changedFiles }) -> string
 *
 * Builds the STRICT-JSON extraction prompt used in Step A of the sync pipeline.
 * The LLM must return only a JSON object — no prose, no code fence — matching
 * the schema below. parseJsonLoose() in core.js handles minor formatting noise.
 * The output is merged into the weekly plan (progress / objectives / blockers /
 * daily summary), so resolvedObjectives must match the EXACT objective text.
 *
 * Parameters:
 *   thesis       - THESIS string
 *   date         - today's date string "YYYY-MM-DD"
 *   objectives   - this week's objectives: array of strings or {text, done}
 *   chat         - raw content of raw/chat/<date>.md (questions + answers)
 *   changedFiles - string[] of changed file paths (from work delta)
 */

"use strict";

function extractFacts({ thesis, date, objectives, chat, changedFiles }) {
  const filesLine =
    changedFiles && changedFiles.length ? changedFiles.join(", ") : "none";

  const objList = (objectives || []).map((o) => (typeof o === "string" ? o : o.text));

  return (
    `${thesis}\n\n` +
    `Extract structured facts from the builder's interview and work delta. Output STRICT JSON ` +
    `only — no prose, no code fence. Schema:\n` +
    `{\n` +
    `  "progress": ["<concrete step taken today toward an objective, with the evidence it happened>"],\n` +
    `  "resolvedObjectives": ["<EXACT text of a week objective below that today's evidence COMPLETES>"],\n` +
    `  "blockers": ["<short phrase of what's in the way>"],\n` +
    `  "summary": "<one factual sentence summarizing today, for the weekly daily-log index>"\n` +
    `}\n` +
    `Use real evidence only (a working result, a test, a user reaction) — never mere intent. ` +
    `resolvedObjectives must match an objective's EXACT text. Empty arrays are fine.\n\n` +
    `Today: ${date}\n` +
    `This week's objectives: ${JSON.stringify(objList)}\n\n` +
    `INTERVIEW:\n${chat}\n\n` +
    `WORK DELTA (files changed): ${filesLine}\n`
  );
}

module.exports = { extractFacts };
