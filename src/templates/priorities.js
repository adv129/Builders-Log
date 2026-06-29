/*
 * Builder Log Agent — Weekly-objectives suggestion prompt (src/templates/priorities.js).
 *
 * suggestObjectives({ thesis, projectPlan, recentProgress, blockers }) -> string
 *
 * Asks the provider for a SHORT, high-level shortlist (≤3) of objectives for the
 * coming week, grounded in the project plan and recent trajectory. Output is
 * STRICT JSON so it parses with parseJsonLoose(). Used to pre-fill the web form
 * and the Slack "what are this week's priorities?" message.
 */

"use strict";

function suggestObjectives({ thesis, projectPlan, recentProgress, blockers }) {
  return (
    `${thesis}\n\n` +
    `Propose a SHORT, high-level shortlist of AT MOST 3 objectives for this builder's coming week. ` +
    `Ground them in the project plan and recent progress/blockers below. ` +
    `Output STRICT JSON only — no prose, no code fence:\n` +
    `{ "objectives": ["<short, high-level objective>"] }\n` +
    `At most 3. One short line each. An empty array is fine if nothing is clear.\n\n` +
    `PROJECT PLAN:\n${projectPlan || "(none yet)"}\n\n` +
    `RECENT PROGRESS: ${(recentProgress || []).join("; ") || "none"}\n` +
    `BLOCKERS: ${(blockers || []).join("; ") || "none"}\n`
  );
}

module.exports = { suggestObjectives };
