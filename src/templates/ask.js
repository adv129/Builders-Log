/*
 * Builder Log Agent — Interview question prompt template.
 *
 * askQuestions({ thesis, objectives, blockers, deltaText, deleted }) -> string
 *
 * Builds the prompt that asks the LLM to generate 3-5 grounded interview
 * questions from the work delta, this week's objectives, and known blockers.
 *
 * Parameters:
 *   thesis     - THESIS string (from templates/thesis.js)
 *   objectives - this week's objectives: array of strings or {text, done}
 *   blockers   - known blockers: array of strings or {text}
 *   deltaText  - pre-formatted string of changed file excerpts (or placeholder)
 *   deleted    - string[] of deleted file paths (may be empty)
 */

"use strict";

// User-editable guidance: WHAT kinds of questions to ask (steerable from
// Settings → Prompts). The output format and the data block below stay fixed in
// code so the response remains a parseable numbered list.
const DEFAULT_ASK_GUIDANCE =
  `A builder just had a work session. Using ONLY the changed files and this week's ` +
  `objectives below, ask 3 to 5 SPECIFIC questions that surface: real evidence of ` +
  `progress toward those objectives (vs. mere activity), the actual thinking/decisions, ` +
  `what's blocking, and any sign AI did the thinking that was the point. Ground every ` +
  `question in something concrete from the files.`;

function asTextList(items, fmt) {
  return (items || []).map((it) => (typeof it === "string" ? it : fmt(it)));
}

function askQuestions({ thesis, objectives, blockers, deltaText, deleted, guidance }) {
  const deletedLine =
    deleted && deleted.length ? `Deleted: ${deleted.join(", ")}\n` : "";

  const instruction = (guidance && guidance.trim()) ? guidance.trim() : DEFAULT_ASK_GUIDANCE;

  const objList = asTextList(objectives, (o) => `${o.done ? "[done] " : ""}${o.text}`);
  const blkList = asTextList(blockers, (b) => b.text);

  return (
    `${thesis}\n\n` +
    `${instruction} ` +
    `Output ONLY a numbered list of questions — no preamble.\n\n` +
    `This week's objectives: ${JSON.stringify(objList)}\n` +
    `Known blockers: ${JSON.stringify(blkList)}\n\n` +
    `Changed files (new/modified):\n${deltaText}\n\n` +
    deletedLine
  );
}

module.exports = { askQuestions, DEFAULT_ASK_GUIDANCE };
