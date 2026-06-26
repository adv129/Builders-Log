/*
 * Builder Log Agent — Synthesis prompt template.
 *
 * synthesizeEntry({ thesis, historyContext, work, chat }) -> string
 *
 * Builds the prompt for Step C of the sync pipeline: the LLM writes the three
 * canonical sections of the Builder Log entry (Builder Log / For your instructor
 * / Friction check).
 *
 * Parameters:
 *   thesis         - THESIS string
 *   historyContext - pre-formatted string of history facts + instructor prefs
 *                   (built by core.js from historyView + config.instructor)
 *   work           - work delta object from raw/work/<date>.json (has .files)
 *   chat           - raw content of raw/chat/<date>.md (questions + answers)
 */

"use strict";

function synthesizeEntry({ thesis, historyContext, work, chat }) {
  const workFilesJson = JSON.stringify((work && work.files) ? work.files : {}, null, 2);

  return (
    `${thesis}\n\n` +
    `From the builder's work delta, interview answers, and the history context below, ` +
    `output exactly these three markdown sections and nothing else:\n\n` +
    `## Builder Log\n- **What I did** — 1 to 3 factual bullets.\n` +
    `- **The thinking behind it** — real decisions, dead-ends, open questions.\n` +
    `- **Evidence** — concrete proof of progress. If only activity with no evidence, say so ` +
    `plainly: "No evidence yet — this is activity, not progress." Never invent evidence.\n` +
    `- **Blocking** — what's in the way, or "Nothing blocking."\n` +
    `- **Next commitment** — ONE specific, checkable commitment.\n\n` +
    `## For your instructor\nTRIAGE: using your own judgment of the history context, surface only the ` +
    `1 to 3 points that genuinely warrant the instructor's attention given what they care about. One ` +
    `sentence of context, then one specific question each. If nothing clears that bar, say exactly ` +
    `"Nothing needs instructor input this cycle." Never manufacture items to fill space.\n\n` +
    `## Friction check\nOne honest read: where AI likely did the thinking that was the point ` +
    `(flag it) vs. cleared genuine noise (fine). If you can't tell, say so. One or two sentences.\n\n` +
    `${historyContext}\n\n` +
    `WORK DELTA:\n${workFilesJson}\n\n` +
    `INTERVIEW:\n${chat}\n`
  );
}

module.exports = { synthesizeEntry };
