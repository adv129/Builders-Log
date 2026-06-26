#!/usr/bin/env node
/*
 * Builder Log Agent — Minimal CLI wrapper (src/cli.js).
 *
 * A thin terminal surface for testing the engine and power-user use.
 * All heavy logic lives in core.js. This file only handles:
 *   - reading config/state
 *   - calling runAsk / runSync / statusView
 *   - printing results to stdout/stderr
 *
 * Subcommands:
 *   node src/cli.js ask     — observe + generate questions; writes raw/chat/<date>.md
 *                             Edit the file, then run sync.
 *   node src/cli.js sync    — read raw/chat/<date>.md answers + synthesize log entry
 *   node src/cli.js status  — print open commitments, blockers, churn
 *
 * This is NOT the user-facing path — the web app is. Keep this tiny.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const {
  loadConfig,
  loadState,
  ensureDirs,
  today,
  runAsk,
  runSync,
  statusView,
  ROOT,
} = require("./core");

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validate(cfg) {
  if (!cfg || !cfg.root) {
    process.stderr.write("config.json missing or no watch folder set. Run onboarding first.\n");
    process.exitCode = 1;
    return false;
  }
  if (cfg.provider === "openrouter" && !process.env.OPENROUTER_API_KEY) {
    process.stderr.write("provider is 'openrouter' but OPENROUTER_API_KEY is not set.\n");
    process.exitCode = 1;
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Subcommands
// ---------------------------------------------------------------------------

async function cmdAsk(cfg, state) {
  process.stderr.write(`Observing ${cfg.root} via ${cfg.provider}…\n`);
  const result = await runAsk(cfg, state);

  if (!result.changed) {
    process.stdout.write("No work changes since last run. Nothing to ask about.\n");
    return;
  }

  process.stdout.write("\n" + result.questions + "\n\n");

  const chatPath = path.join(ROOT, "raw", "chat", `${result.date}.md`);
  process.stdout.write(
    `Questions written to raw/chat/${result.date}.md\n` +
    `Answer there (edit the "> _answer:_" lines), then run:\n` +
    `  node src/cli.js sync\n`
  );
}

async function cmdSync(cfg, state) {
  const date = today();
  const chatPath = path.join(ROOT, "raw", "chat", `${date}.md`);

  if (!fs.existsSync(chatPath)) {
    process.stderr.write(`No interview for ${date}. Run: node src/cli.js ask\n`);
    process.exitCode = 1;
    return;
  }

  const answersText = fs.readFileSync(chatPath, "utf8");

  process.stderr.write(`Extracting commitments/blockers via ${cfg.provider}…\n`);
  // Pass answersText; runSync will use it directly (file already has user's edits).
  const result = await runSync(cfg, state, { answersText });

  const relLog = path.relative(ROOT, result.logPath);
  process.stdout.write(`\nWrote ${relLog} and committed snapshot.\n`);
  process.stdout.write(
    `Memory: ${result.memory.open} open commitment(s)` +
    (result.memory.resolvedThisRun ? `, ${result.memory.resolvedThisRun} resolved this run` : "") +
    `.\n`
  );

  if (result.instructorDraft && !/nothing needs instructor input/i.test(result.instructorDraft)) {
    process.stdout.write(
      `Instructor note drafted to raw/instructor/${result.date}.md` +
      ` (${result.gated ? "gated" : "auto-send"}).\n`
    );
  } else {
    process.stdout.write("Nothing flagged for the instructor this cycle.\n");
  }
}

function cmdStatus(cfg, state) {
  const view = statusView(cfg, state);

  process.stdout.write(
    `Builder: ${view.builder} · Provider: ${view.provider} · Last run: ${view.lastRun || "never"}\n`
  );

  process.stdout.write(`\nOpen commitments (${view.openCommitments.length}):\n`);
  for (const c of view.openCommitments) {
    process.stdout.write(
      `  ${c.id}: ${c.text}${c.due ? ` (due ${c.due})` : ""} — opened ${c.openedOn} ` +
      `(${c.daysOpen}d ago), carried ${c.carried}x, evidence: ${c.hasEvidence ? "yes" : "none"}\n`
    );
  }

  process.stdout.write(`Resolved (${view.resolved.length}):\n`);
  for (const c of view.resolved) {
    process.stdout.write(`  ${c.id}: ${c.text} — ${c.resolvedOn} (${c.evidence})\n`);
  }

  if (view.blockers.length) {
    process.stdout.write(`\nBlockers seen (${view.blockers.length}):\n`);
    for (const b of view.blockers) {
      process.stdout.write(`  ${b.text} — ${b.count}x (last ${b.lastSeen})\n`);
    }
  }

  if (view.churn.length) {
    process.stdout.write("\nFile churn:\n");
    for (const c of view.churn) {
      process.stdout.write(`  ${c.file} — ${c.changes} changes\n`);
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

(async () => {
  const cmd = process.argv[2];

  const cfg = loadConfig();
  if (!validate(cfg)) return;

  // Apply config defaults before dispatching.
  cfg.provider = cfg.provider || "claude-p";
  cfg.chatSurface = cfg.chatSurface || "terminal";

  const state = loadState();
  // Clean up legacy orphaned field from earlier state shapes.
  delete state.lastFlags;

  ensureDirs();

  try {
    if (cmd === "ask") {
      await cmdAsk(cfg, state);
    } else if (cmd === "sync") {
      await cmdSync(cfg, state);
    } else if (cmd === "status") {
      cmdStatus(cfg, state);
    } else {
      process.stderr.write(
        "Usage:\n" +
        "  node src/cli.js ask     — observe work delta, generate questions\n" +
        "  node src/cli.js sync    — synthesize log entry from answered raw/chat\n" +
        "  node src/cli.js status  — print open commitments + history\n"
      );
      process.exitCode = 1;
    }
  } catch (err) {
    process.stderr.write(`Error: ${err.message}\n`);
    process.exitCode = 1;
  }
})();
