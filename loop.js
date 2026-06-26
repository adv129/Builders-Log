#!/usr/bin/env node
/*
 * Builder Log Agent — Core loop (Phase 2)
 *
 * Provider-agnostic, trigger-based. Two steps that match the "delta since
 * lastRun" model (so the same shape works for terminal now and Slack later):
 *
 *   node loop.js ask    # observe work delta -> ask grounded questions
 *                       #   writes raw/work/DATE.json + raw/chat/DATE.md (questions)
 *   node loop.js sync   # read answered chat -> synthesize the log entry
 *                       #   writes log/DATE.md, commits the file snapshot
 *
 * The interview is split across the two steps on purpose: `ask` poses questions,
 * the student answers (in the chat file now, in Slack later), `sync` reads them
 * back as just another input delta.
 *
 * Every LLM call goes through complete() — swap the provider in config.json.
 */

const fs = require("fs");
const path = require("path");
const { snapshot, diff } = require("./observe");
const { complete } = require("./provider");
const { applyExtraction, bumpChurn, historyView } = require("./track");
const slack = require("./connectors/slack");

const HERE = __dirname;
const CONFIG_PATH = path.join(HERE, "config.json");
const STATE_PATH = path.join(HERE, "state.json");
const MAX_EXCERPT = 4000; // chars of each changed file fed to the model

function today() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function readJson(p, fallback) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return fallback;
  }
}

// Parse JSON from an LLM reply that may include prose or a code fence.
function parseJsonLoose(s) {
  let t = (s || "").trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(t);
  if (fence) t = fence[1].trim();
  const first = t.indexOf("{");
  const last = t.lastIndexOf("}");
  if (first !== -1 && last !== -1) t = t.slice(first, last + 1);
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}

function ensureDirs() {
  for (const d of ["raw/work", "raw/chat", "raw/instructor", "log", "reports"]) {
    fs.mkdirSync(path.join(HERE, d), { recursive: true });
  }
}

function saveState(state) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + "\n");
}

// Pull the "## For your instructor" section out of a synthesized entry.
function extractInstructorSection(entry) {
  const m = /##\s*For your instructor\s*\n([\s\S]*?)(?=\n##\s|\s*$)/i.exec(entry);
  return m ? m[1].trim() : "";
}

// Read the changed files' contents (truncated) so questions are grounded.
function gatherDelta(root, d) {
  const files = {};
  for (const rel of [...d.added, ...d.modified]) {
    let content = "";
    try {
      content = fs.readFileSync(path.join(root, rel), "utf8");
    } catch {
      content = "(could not read)";
    }
    files[rel] = {
      change: d.added.includes(rel) ? "new" : "modified",
      excerpt: content.slice(0, MAX_EXCERPT),
      truncated: content.length > MAX_EXCERPT,
    };
  }
  return files;
}

function deltaForPrompt(files) {
  if (Object.keys(files).length === 0) return "(no file changes detected)";
  return Object.entries(files)
    .map(([rel, f]) => `### ${rel} (${f.change})\n${f.excerpt}${f.truncated ? "\n…(truncated)" : ""}`)
    .join("\n\n");
}

const THESIS =
  `You are the Builders Club "Builder Log" agent. RECORD, DON'T DICTATE. ` +
  `You reflect and surface what's there. Never nag, lecture, pad, or cheerlead. ` +
  `Plain language. No emojis. Concise. Evidence over activity.`;

// ---------------------------------------------------------------- ask
async function cmdAsk(cfg, state) {
  const root = cfg.root;
  const curr = snapshot(root);
  const d = diff(state.files, curr);
  const changed = [...d.added, ...d.modified];

  if (changed.length === 0 && d.deleted.length === 0) {
    console.log("No work changes since last run. Nothing to ask about.");
    return;
  }

  const files = gatherDelta(root, d);
  const date = today();

  const prompt =
    `${THESIS}\n\n` +
    `A builder just had a work session. Using ONLY the changed files and their open ` +
    `commitments below, ask 3 to 5 SPECIFIC questions that surface: real evidence of ` +
    `progress (vs. mere activity), the actual thinking/decisions, what's blocking, and ` +
    `any sign AI did the thinking that was the point. Ground every question in something ` +
    `concrete from the files. Output ONLY a numbered list of questions — no preamble.\n\n` +
    `Open commitments: ${JSON.stringify(state.commitments || [])}\n\n` +
    `Changed files (new/modified):\n${deltaForPrompt(files)}\n\n` +
    (d.deleted.length ? `Deleted: ${d.deleted.join(", ")}\n` : "");

  process.stderr.write(`Observing ${changed.length} changed file(s); generating questions via ${cfg.provider}…\n`);
  const questions = await complete(prompt, { provider: cfg.provider, config: cfg });

  // RAW: persist the work delta verbatim.
  fs.writeFileSync(
    path.join(HERE, "raw", "work", `${date}.json`),
    JSON.stringify({ date, root, ...d, files }, null, 2) + "\n"
  );

  // RAW: open the chat transcript with the questions + blank answer slots.
  const chatPath = path.join(HERE, "raw", "chat", `${date}.md`);
  const qLines = questions
    .split("\n")
    .filter((l) => l.trim())
    .map((q) => `**${q.trim()}**\n\n> _answer:_ \n`)
    .join("\n");
  fs.writeFileSync(chatPath, `# Interview — ${date}\n\n${qLines}`);

  console.log("\n" + questions + "\n");

  if (cfg.chatSurface === "slack") {
    const { channel, ts } = await slack.sendToUser(cfg.slack.studentUserId, questions);
    state.slack = state.slack || {};
    state.slack.studentChannel = channel;
    state.slack.studentTs = ts; // read replies strictly after the questions
    saveState(state); // persist cursor WITHOUT committing the file snapshot (sync does that)
    console.log("Sent questions to the student via Slack. Run `node loop.js sync` after they reply.");
  } else {
    console.log(`Questions written to ${path.relative(HERE, chatPath)} — answer there, then run: node loop.js sync`);
  }
}

// --------------------------------------------------------------- sync
async function cmdSync(cfg, state) {
  const date = today();
  const chatPath = path.join(HERE, "raw", "chat", `${date}.md`);
  const workPath = path.join(HERE, "raw", "work", `${date}.json`);

  if (!fs.existsSync(chatPath)) {
    console.error(`No interview for ${date}. Run: node loop.js ask`);
    process.exit(1);
  }
  let chat = fs.readFileSync(chatPath, "utf8");
  const work = readJson(workPath, {});
  const changedFiles = Object.keys(work.files || {});
  const openBefore = (state.commitments || []).filter((c) => c.status === "open");

  // Slack: read the student's replies since the questions were posted, and fold
  // in any instructor replies — both as deltas, captured verbatim into RAW.
  if (cfg.chatSurface === "slack") {
    state.slack = state.slack || {};
    const sCh = state.slack.studentChannel || (await slack.openDm(cfg.slack.studentUserId));
    const replies = await slack.historySince(sCh, state.slack.studentTs);
    if (!replies.length) {
      console.error("No student replies in Slack yet. Try again after they respond.");
      process.exit(1);
    }
    fs.appendFileSync(chatPath, `\n\n## Student replies (Slack)\n${replies.map((m) => `> ${m.text}`).join("\n")}\n`);
    chat = fs.readFileSync(chatPath, "utf8");
    state.slack.studentChannel = sCh;
    state.slack.studentTs = replies[replies.length - 1].ts;

    if (cfg.slack.instructorUserId) {
      const iCh = state.slack.instructorChannel || (await slack.openDm(cfg.slack.instructorUserId));
      const iReplies = await slack.historySince(iCh, state.slack.instructorTs);
      if (iReplies.length) {
        state.instructorThread = state.instructorThread || [];
        for (const m of iReplies) state.instructorThread.push({ date, direction: "from-instructor", text: m.text });
        fs.appendFileSync(path.join(HERE, "raw", "instructor", `${date}.md`), `\n## Instructor replies (Slack) — ${date}\n${iReplies.map((m) => `> ${m.text}`).join("\n")}\n`);
        state.slack.instructorChannel = iCh;
        state.slack.instructorTs = iReplies[iReplies.length - 1].ts;
      }
    }
  }
  const recentInstructor = (state.instructorThread || []).slice(-3);

  // --- Step 1: extract structured facts (memory update) ---
  const exPrompt =
    `${THESIS}\n\n` +
    `Extract structured facts from the builder's interview and work delta. Output STRICT JSON ` +
    `only — no prose, no code fence. Schema:\n` +
    `{\n` +
    `  "resolved": [{"id":"<id of an OPEN commitment that today gives real EVIDENCE of completing>","evidence":"<the concrete evidence>"}],\n` +
    `  "newCommitments": [{"text":"<one specific, checkable commitment made for next time>","due":"<YYYY-MM-DD or null>"}],\n` +
    `  "blockers": ["<short phrase of what's in the way>"]\n` +
    `}\n` +
    `Mark resolved ONLY with real evidence today (a working result, a test, a user reaction) — never mere intent. Empty arrays are fine.\n\n` +
    `Today: ${date}\n` +
    `Open commitments: ${JSON.stringify(openBefore)}\n\n` +
    `INTERVIEW:\n${chat}\n\n` +
    `WORK DELTA (files changed): ${changedFiles.join(", ") || "none"}\n`;

  process.stderr.write(`Extracting commitments/blockers via ${cfg.provider}…\n`);
  const extraction = parseJsonLoose(await complete(exPrompt, { provider: cfg.provider, config: cfg })) || {};

  applyExtraction(state, extraction, date);
  bumpChurn(state, changedFiles);
  const view = historyView(state, date);

  // --- Step 2: synthesize the entry. The LLM judges significance from the
  // raw history below — no pre-computed flags, no fixed thresholds. ---
  const historyContext =
    `HISTORY CONTEXT (raw accumulated facts — NOT pre-judged):\n` +
    `- Open commitments: ${view.openCommitments.length ? view.openCommitments.map((c) => `${c.id} "${c.text}" (opened ${c.openedOn}, ${c.daysOpen}d ago, carried ${c.carried}x, evidence: ${c.hasEvidence ? "yes" : "none"}${c.due ? `, due ${c.due}` : ""})`).join("; ") : "none"}\n` +
    `- Blockers seen: ${view.blockers.length ? view.blockers.map((b) => `"${b.text}" (seen ${b.count}x, last ${b.lastSeen})`).join("; ") : "none"}\n` +
    `- File churn: ${view.churn.length ? view.churn.map((c) => `${c.file} (${c.changes} changes)`).join("; ") : "none"}\n` +
    `Instructor cares about: ${(cfg.instructor?.caresAbout || []).join("; ") || "n/a"}. ` +
    `Wants flagged early: ${(cfg.instructor?.wantsFlaggedEarly || []).join("; ") || "n/a"}.\n` +
    `Recent instructor messages: ${recentInstructor.length ? recentInstructor.map((m) => `"${m.text}"`).join("; ") : "none"}\n` +
    `Using this history together with the instructor's priorities and the builder's context, YOU decide ` +
    `what is significant — which commitments are stalling, which blockers are worth escalating, what to ` +
    `surface to the instructor. Do not apply fixed day thresholds; judge from the trajectory and what ` +
    `this instructor said they care about.`;

  const prompt =
    `${THESIS}\n\n` +
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
    `WORK DELTA:\n${JSON.stringify(work.files || {}, null, 2)}\n\n` +
    `INTERVIEW:\n${chat}\n`;

  process.stderr.write(`Synthesizing the log entry via ${cfg.provider}…\n`);
  const entry = await complete(prompt, { provider: cfg.provider, config: cfg });

  const header = `# Builder Log — ${date}\n\n_Builder: ${cfg.builder?.name || "?"} · Project: ${cfg.builder?.project || "?"}_\n_Files changed: ${Object.keys(work.files || {}).join(", ") || "none"}_\n\n`;
  const logPath = path.join(HERE, "log", `${date}.md`);
  fs.writeFileSync(logPath, header + entry + "\n");

  // Instructor triage: draft now, send only on explicit approval (gated).
  const instructorDraft = extractInstructorSection(entry);
  const gate = cfg.slack?.gateInstructorMessages !== false; // default: gated
  let instructorMsg = "";
  if (instructorDraft && !/nothing needs instructor input/i.test(instructorDraft)) {
    fs.appendFileSync(
      path.join(HERE, "raw", "instructor", `${date}.md`),
      `\n## Draft for instructor (outbound) — ${date}\n${instructorDraft}\n`
    );
    if (cfg.chatSurface === "slack" && !gate) {
      const { channel, ts } = await slack.sendToUser(cfg.slack.instructorUserId, instructorDraft);
      state.slack = state.slack || {};
      state.slack.instructorChannel = channel;
      state.slack.instructorTs = ts;
      instructorMsg = "Posted the instructor note to Slack (auto-send on).";
    } else {
      state.slack = state.slack || {};
      state.slack.pendingInstructor = { date, text: instructorDraft };
      instructorMsg =
        cfg.chatSurface === "slack"
          ? "Instructor note drafted (gated). Review raw/instructor and run `node loop.js send-instructor` to post."
          : "Instructor note drafted to raw/instructor (terminal mode — forward it yourself).";
    }
  } else {
    instructorMsg = "Nothing flagged for the instructor this cycle.";
  }

  // Commit the file snapshot so the next run only sees genuinely new changes.
  state.files = snapshot(cfg.root);
  state.lastRun = new Date().toISOString();
  saveState(state);

  console.log(`\nWrote ${path.relative(HERE, logPath)} and committed snapshot.`);
  const open = state.commitments.filter((c) => c.status === "open");
  const done = (extraction.resolved || []).length;
  console.log(`Memory: ${open.length} open commitment(s)${done ? `, ${done} resolved this run` : ""}.`);
  console.log(instructorMsg);
}

// --------------------------------------------------- send-instructor (gated post)
async function cmdSendInstructor(cfg, state) {
  if (cfg.chatSurface !== "slack") {
    console.error("send-instructor requires chatSurface 'slack'.");
    process.exit(1);
  }
  const pending = state.slack?.pendingInstructor;
  if (!pending || !pending.text) {
    console.log("No pending instructor note to send.");
    return;
  }
  const { channel, ts } = await slack.sendToUser(cfg.slack.instructorUserId, pending.text);
  state.slack.instructorChannel = channel;
  state.slack.instructorTs = ts;
  delete state.slack.pendingInstructor;
  saveState(state);
  console.log(`Sent the ${pending.date} instructor note to Slack.`);
}

// Print factual history — no verdict, no thresholds.
function printHistory(view) {
  if (view.blockers.length) {
    console.log(`Blockers seen (${view.blockers.length}):`);
    for (const b of view.blockers) console.log(`  ${b.text} — ${b.count}x (last ${b.lastSeen})`);
  }
  if (view.churn.length) {
    console.log("File churn:");
    for (const c of view.churn) console.log(`  ${c.file} — ${c.changes} changes`);
  }
}

// --------------------------------------------------------------- status
function cmdStatus(cfg, state) {
  console.log(`Builder: ${cfg.builder?.name || "?"} · Provider: ${cfg.provider} · Last run: ${state.lastRun || "never"}`);
  const view = historyView(state, today());
  const done = (state.commitments || []).filter((c) => c.status === "done");
  console.log(`\nOpen commitments (${view.openCommitments.length}):`);
  for (const c of view.openCommitments)
    console.log(`  ${c.id}: ${c.text}${c.due ? ` (due ${c.due})` : ""} — opened ${c.openedOn} (${c.daysOpen}d ago), carried ${c.carried}x, evidence: ${c.hasEvidence ? "yes" : "none"}`);
  console.log(`Resolved (${done.length}):`);
  for (const c of done) console.log(`  ${c.id}: ${c.text} — ${c.resolvedOn} (${c.evidence})`);
  console.log("");
  printHistory(view);
}

// --------------------------------------------------------------- main
(async () => {
  const cmd = process.argv[2];
  const cfg = readJson(CONFIG_PATH, null);
  const state = readJson(STATE_PATH, { lastRun: null, files: {}, commitments: [], blockers: [], instructorThread: [] });

  if (!cfg || !cfg.root) {
    console.error("config.json missing or no watch folder set. Run onboarding first.");
    process.exit(1);
  }
  cfg.provider = cfg.provider || "claude-p";
  cfg.chatSurface = cfg.chatSurface || "terminal";
  if (cfg.provider === "openrouter" && !process.env.OPENROUTER_API_KEY) {
    console.error("provider is 'openrouter' but OPENROUTER_API_KEY is not set in the environment.");
    process.exit(1);
  }
  delete state.lastFlags; // orphaned by the removal of the deterministic flag layer
  ensureDirs();

  try {
    if (cmd === "ask") await cmdAsk(cfg, state);
    else if (cmd === "sync") await cmdSync(cfg, state);
    else if (cmd === "status") cmdStatus(cfg, state);
    else if (cmd === "send-instructor") await cmdSendInstructor(cfg, state);
    else {
      console.error(
        "Usage: node loop.js ask              (observe + ask questions)\n" +
        "       node loop.js sync             (synthesize from answers)\n" +
        "       node loop.js status           (open commitments + history)\n" +
        "       node loop.js send-instructor  (post the gated instructor note to Slack)"
      );
      process.exit(1);
    }
  } catch (err) {
    console.error("Loop failed:", err.message);
    process.exit(1);
  }
})();
