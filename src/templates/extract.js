/*
 * Builder Log Agent — Extraction prompt template.
 *
 * extractFacts({ thesis, date, openCommitments, chat, changedFiles }) -> string
 *
 * Builds the STRICT-JSON extraction prompt used in Step A of the sync pipeline.
 * The LLM must return only a JSON object — no prose, no code fence — matching
 * the schema below. parseJsonLoose() in core.js handles minor formatting noise.
 *
 * Parameters:
 *   thesis          - THESIS string
 *   date            - today's date string "YYYY-MM-DD"
 *   openCommitments - JSON-serializable array of open commitment objects
 *   chat            - raw content of raw/chat/<date>.md (questions + answers)
 *   changedFiles    - string[] of changed file paths (from work delta)
 */

"use strict";

function extractFacts({ thesis, date, openCommitments, chat, changedFiles }) {
  const filesLine =
    changedFiles && changedFiles.length ? changedFiles.join(", ") : "none";

  return (
    `${thesis}\n\n` +
    `Extract structured facts from the builder's interview and work delta. Output STRICT JSON ` +
    `only — no prose, no code fence. Schema:\n` +
    `{\n` +
    `  "resolved": [{"id":"<id of an OPEN commitment that today gives real EVIDENCE of completing>","evidence":"<the concrete evidence>"}],\n` +
    `  "newCommitments": [{"text":"<one specific, checkable commitment made for next time>","due":"<YYYY-MM-DD or null>"}],\n` +
    `  "blockers": ["<short phrase of what's in the way>"]\n` +
    `}\n` +
    `Mark resolved ONLY with real evidence today (a working result, a test, a user reaction) — never mere intent. Empty arrays are fine.\n\n` +
    `Today: ${date}\n` +
    `Open commitments: ${JSON.stringify(openCommitments || [])}\n\n` +
    `INTERVIEW:\n${chat}\n\n` +
    `WORK DELTA (files changed): ${filesLine}\n`
  );
}

module.exports = { extractFacts };
