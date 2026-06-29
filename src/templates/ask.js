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

// Reflection mode: no files changed this session. A lot of real build progress
// is not a diff — meetings, decisions, user conversations, dead-ends, time spent
// stuck. This guidance keeps the check-in useful when there is nothing to ground
// in code. The file-oriented default/custom guidance is bypassed in this mode.
const REFLECTIVE_ASK_GUIDANCE =
  `No files changed since the last check-in, so this is a reflection check-in. Ask 3 to 5 ` +
  `SPECIFIC questions that surface what the builder actually did, decided, discussed, or got ` +
  `stuck on — meetings, design decisions, user conversations, dead-ends, or thinking that ` +
  `hasn't landed in code yet. Ground every question in this week's objectives and known ` +
  `blockers below, and look for real evidence of progress vs. mere activity.`;

function asTextList(items, fmt) {
  return (items || []).map((it) => (typeof it === "string" ? it : fmt(it)));
}

function askQuestions({ thesis, objectives, blockers, deltaText, deleted, guidance, reflective }) {
  const deletedLine =
    deleted && deleted.length ? `Deleted: ${deleted.join(", ")}\n` : "";

  // In reflection mode the file-centric default/custom guidance does not apply
  // (there are no files), so use the reflective instruction. Otherwise honor a
  // user override, falling back to the grounded default.
  const instruction = reflective
    ? REFLECTIVE_ASK_GUIDANCE
    : ((guidance && guidance.trim()) ? guidance.trim() : DEFAULT_ASK_GUIDANCE);

  const objList = asTextList(objectives, (o) => `${o.done ? "[done] " : ""}${o.text}`);
  const blkList = asTextList(blockers, (b) => b.text);

  const workBlock = reflective
    ? `No files changed this session — this is a reflection check-in.\n\n`
    : `Changed files (new/modified):\n${deltaText}\n\n`;

  return (
    `${thesis}\n\n` +
    `${instruction} ` +
    `Output ONLY a numbered list of questions — no preamble.\n\n` +
    `This week's objectives: ${JSON.stringify(objList)}\n` +
    `Known blockers: ${JSON.stringify(blkList)}\n\n` +
    workBlock +
    deletedLine
  );
}

module.exports = { askQuestions, DEFAULT_ASK_GUIDANCE, REFLECTIVE_ASK_GUIDANCE };
