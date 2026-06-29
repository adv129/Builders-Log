/*
 * Builder Log Agent — Project-plan template (src/templates/projectPlan.js).
 *
 * The project plan (plan/project.md) is the high-level, slow-changing overview
 * of the whole build. It refreshes WEEKLY, not daily. This module owns:
 *
 *   PROJECT_PLAN_FORMAT          the canonical markdown structure project.md follows
 *   projectPlanPrompt({...})     the prompt that (re)generates project.md in that
 *                                format — used BOTH by the agent to generate it and
 *                                verbatim behind the "Copy prompt" button in the UI
 *                                (Settings + onboarding).
 *
 * Two modes:
 *   "existing"  — map the builder's EXISTING directories to the project (read-only,
 *                 no restructuring). Used when they already have work.
 *   "scaffold"  — propose a folder layout from the project description. Used for a
 *                 greenfield start (the agent then creates those dirs once).
 */

"use strict";

// Canonical structure. Kept stable so the plan is parseable and the "redo"
// prompt always produces the same shape.
const PROJECT_PLAN_FORMAT = [
  "# Project Plan — <project name>",
  "",
  "## Vision",
  "<1–2 short paragraphs: what this project is and the outcome it's driving toward>",
  "",
  "## Milestones",
  "- <milestone> — <the concrete outcome that marks it done>",
  "",
  "## Workstreams",
  "- <workstream> — <what it covers> (→ <which folder/dir it lives in>)",
  "",
  "## Current focus",
  "<the one or two things that matter most right now>",
  "",
  "## Where things live",
  "- <folder/dir> — <one line: what work happens here>",
].join("\n");

function dirsBlock(dirs) {
  if (!dirs || !dirs.length) return "(none provided)";
  return dirs
    .map((d) => (typeof d === "string" ? `- ${d}` : `- ${d.path}${d.label ? ` (${d.label})` : ""}`))
    .join("\n");
}

/**
 * projectPlanPrompt({ cfg, dirs, mode }) -> string
 *
 * cfg  - loaded config (uses builder.project / builder.context / instructor.*)
 * dirs - array of {path,label} or strings — the tracked roots
 * mode - "existing" (default) | "scaffold"
 */
function projectPlanPrompt({ cfg, dirs, mode } = {}) {
  const c = cfg || {};
  const project = c.builder?.project || "(project description not set)";
  const context = c.builder?.context || "";
  const goal = c.instructor?.currentGoal || "";
  const m = mode === "scaffold" ? "scaffold" : "existing";

  const modeLine =
    m === "scaffold"
      ? "The builder is starting fresh. PROPOSE a simple folder layout that fits the " +
        "project, and describe each proposed folder under 'Where things live'."
      : "The builder already has the directories listed below. Map how each one relates " +
        "to the overall project. Do NOT propose moving or restructuring anything — just " +
        "describe what is where.";

  return (
    `Write a concise project plan in markdown, following EXACTLY this structure ` +
    `(keep the headings verbatim):\n\n` +
    `${PROJECT_PLAN_FORMAT}\n\n` +
    `${modeLine}\n\n` +
    `Project: ${project}\n` +
    (context ? `Builder context: ${context}\n` : "") +
    (goal ? `Instructor's current goal/milestone: ${goal}\n` : "") +
    `Directories:\n${dirsBlock(dirs)}\n\n` +
    `Keep it tight and high-level — this is the slow-changing overview, not a task list. ` +
    `Output only the markdown.`
  );
}

module.exports = { PROJECT_PLAN_FORMAT, projectPlanPrompt };
