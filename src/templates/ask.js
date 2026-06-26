/*
 * Builder Log Agent — Interview question prompt template.
 *
 * askQuestions({ thesis, openCommitments, deltaText, deleted }) -> string
 *
 * Builds the prompt that asks the LLM to generate 3-5 grounded interview
 * questions from the work delta and the builder's open commitments.
 *
 * Parameters:
 *   thesis          - THESIS string (from templates/thesis.js)
 *   openCommitments - JSON-serializable array of open commitment objects from state
 *   deltaText       - pre-formatted string of changed file excerpts (or placeholder)
 *   deleted         - string[] of deleted file paths (may be empty)
 */

"use strict";

function askQuestions({ thesis, openCommitments, deltaText, deleted }) {
  const deletedLine =
    deleted && deleted.length ? `Deleted: ${deleted.join(", ")}\n` : "";

  return (
    `${thesis}\n\n` +
    `A builder just had a work session. Using ONLY the changed files and their open ` +
    `commitments below, ask 3 to 5 SPECIFIC questions that surface: real evidence of ` +
    `progress (vs. mere activity), the actual thinking/decisions, what's blocking, and ` +
    `any sign AI did the thinking that was the point. Ground every question in something ` +
    `concrete from the files. Output ONLY a numbered list of questions — no preamble.\n\n` +
    `Open commitments: ${JSON.stringify(openCommitments || [])}\n\n` +
    `Changed files (new/modified):\n${deltaText}\n\n` +
    deletedLine
  );
}

module.exports = { askQuestions };
