#!/usr/bin/env node
/*
 * Builder Log Agent — Onboarding (Phase 1)
 *
 * One-time setup. Holds the watch folder, builder/project context, and the
 * instructor's stated preferences in config.json. The actual Q&A is conducted by
 * the agent in conversation (builder side) and by the instructor filling
 * INSTRUCTOR_ONBOARDING.md (instructor side); this script initializes, validates,
 * and summarizes that config.
 *
 * Usage:
 *   node onboard.js --check            # report what setup is still missing
 *   node onboard.js --summary          # print current config in human-readable form
 *   node onboard.js --instructor-doc   # (re)generate INSTRUCTOR_ONBOARDING.md to send
 */

const fs = require("fs");
const path = require("path");

const HERE = __dirname;
const CONFIG_PATH = path.join(HERE, "config.json");
const INSTRUCTOR_DOC_PATH = path.join(HERE, "INSTRUCTOR_ONBOARDING.md");

const INSTRUCTOR_QUESTIONS = [
  "What do you most want to know about this person's progress each cycle?",
  "What does *real* progress look like to you here — what evidence actually convinces you?",
  "What do you want flagged early (blockers, risks, scope changes, anything else)?",
  "How often, and in what format, do you want updates? (e.g. weekly, short note / doc)",
  "What is NOT useful — what would you rather never see in an update?",
  "Is there a current goal or milestone you're measuring this work against?",
];

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  } catch {
    return null;
  }
}

function check(cfg) {
  const missing = [];
  if (!cfg) return ["config.json is missing or invalid"];
  if (!cfg.root) missing.push("watch folder (config.root)");
  if (!cfg.builder || !cfg.builder.name) missing.push("builder name");
  if (!cfg.builder || !cfg.builder.project) missing.push("builder project/context");
  if (!cfg.instructor || !cfg.instructor.name) missing.push("instructor name");
  if (!cfg.instructor || !cfg.instructor.answeredOn) missing.push("instructor's answers (send INSTRUCTOR_ONBOARDING.md)");
  return missing;
}

function summary(cfg) {
  if (!cfg) return "No config found.";
  const lines = [];
  lines.push(`Setup complete: ${cfg.setupComplete ? "yes" : "no"}`);
  lines.push(`Watch folder:   ${cfg.root || "(not set)"}`);
  lines.push(`Builder:        ${cfg.builder?.name || "(not set)"} — ${cfg.builder?.project || "(no project)"}`);
  lines.push(`Instructor:     ${cfg.instructor?.name || "(not set)"}`);
  lines.push(`  cares about:  ${(cfg.instructor?.caresAbout || []).join("; ") || "(not answered)"}`);
  lines.push(`  cadence:      ${cfg.instructor?.cadence || "(not answered)"}`);
  lines.push(`  format:       ${cfg.instructor?.format || "(not answered)"}`);
  return lines.join("\n");
}

function instructorDoc(cfg) {
  const builder = cfg?.builder?.name || "the builder";
  const project = cfg?.builder?.project ? ` (${cfg.builder.project})` : "";
  const qs = INSTRUCTOR_QUESTIONS.map((q, i) => `${i + 1}. ${q}\n\n   > _your answer_\n`).join("\n");
  return `# Builder Log — quick setup (for ${cfg?.instructor?.name || "the instructor"})\n\n` +
    `${builder} is piloting a tool that keeps a disciplined log of their work${project} and\n` +
    `sends you a short, signal-only update. So it surfaces what *you* actually want — and nothing\n` +
    `you don't — please answer the few questions below in your own words.\n\n` +
    `---\n\n${qs}\n---\n\nThat's it. Send it back and the updates will be shaped around these answers.\n`;
}

function main() {
  const a = process.argv.slice(2);
  const cfg = loadConfig();

  if (a.includes("--instructor-doc")) {
    fs.writeFileSync(INSTRUCTOR_DOC_PATH, instructorDoc(cfg));
    process.stdout.write(`Wrote ${path.relative(HERE, INSTRUCTOR_DOC_PATH)}\n`);
    return;
  }
  if (a.includes("--summary")) {
    process.stdout.write(summary(cfg) + "\n");
    return;
  }
  // default: --check
  const missing = check(cfg);
  if (missing.length === 0) {
    process.stdout.write("Onboarding complete. Ready for the daily loop.\n");
  } else {
    process.stdout.write("Onboarding incomplete. Still needed:\n");
    for (const m of missing) process.stdout.write(`  - ${m}\n`);
  }
}

main();
