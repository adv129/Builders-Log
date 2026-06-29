/*
 * Builder Log Agent — Slack action layer (src/slack-actions.js).
 *
 * High-level Slack operations that the server routes and CLI can call.
 * All functions are surface-agnostic: they read config + state, call the
 * Slack connector, and return structured results. No HTTP, no console.log.
 *
 * Exported API:
 *
 *   async sendReminder(cfg, { appUrl })
 *     DM the builder (cfg.slack.studentUserId) a short check-in reminder
 *     that includes appUrl (the local web app link).
 *     Returns { ok, channel, ts }.
 *     Throws if chatSurface !== "slack", studentUserId or token missing.
 *
 *   async sendInstructorNote(cfg, { date, text })
 *     DM the instructor (cfg.slack.instructorUserId) the note for `date`. Uses
 *     `text` when provided (the student-edited note); otherwise reads the latest
 *     "Draft for instructor (outbound)" section from raw/instructor/<date>.md.
 *     Records what was sent ("## Sent to instructor" section, append-only).
 *     Returns { ok, channel, ts } or { ok: false, reason: "nothing to send" }.
 *     Throws if chatSurface !== "slack", instructorUserId or token missing.
 *
 *   async collectInstructorFeedback(cfg, state)
 *     Read instructor replies since state.slack.instructorNoteTs — the return
 *     leg of the sync loop. Returns { channel, messages } only.
 *
 *   async askInstructor(cfg)                  [future — not wired to UI yet]
 *     DM the 6 INSTRUCTOR_QUESTIONS to the instructor.
 *     Returns { ok, channel, ts }.
 *
 *   async collectInstructorAnswers(cfg, state) [future — not wired to UI yet]
 *     Read instructor replies via historySince and RETURN them.
 *     Does not write to state; caller decides what to do with the messages.
 *     Returns { channel, messages: [{ts, text, user}] }.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const { sendToUser, openDm, historySince, authTest } = require("./connectors/slack");
const { INSTRUCTOR_QUESTIONS } = require("./templates/onboard");
const { ROOT, today } = require("./core");

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Guard: throws clear error if Slack is not configured for use.
 * Checks chatSurface, the required userId, and the token env var.
 */
function requireSlack(cfg, userIdKey) {
  if (cfg.chatSurface !== "slack") {
    throw new Error(
      "chatSurface is not 'slack' — Slack actions are only available when chatSurface is set to 'slack'"
    );
  }
  const userId = cfg.slack && cfg.slack[userIdKey];
  if (!userId) {
    throw new Error(
      `cfg.slack.${userIdKey} is not set — configure it in Settings or config.json`
    );
  }
  if (!process.env.SLACK_BOT_TOKEN) {
    throw new Error("SLACK_BOT_TOKEN is not set — add it to your .env file");
  }
  return userId;
}

/**
 * Extract the latest "Draft for instructor (outbound)" section from a file.
 * Core appends sections in this format:
 *   \n## Draft for instructor (outbound) — YYYY-MM-DD\n<draft text>\n
 *
 * Returns the draft body string, or null if none found.
 */
function extractLatestDraft(content) {
  // Split on the section header; take the last part (handles multiple appends).
  const parts = content.split(/\n## Draft for instructor \(outbound\)[^\n]*\n/);
  if (parts.length < 2) return null;
  const body = parts[parts.length - 1].trim();
  return body || null;
}

// ---------------------------------------------------------------------------
// Exported actions
// ---------------------------------------------------------------------------

/**
 * sendReminder(cfg, { appUrl }) -> Promise<{ ok, channel, ts }>
 *
 * DM the builder a short check-in reminder with a link to the web app.
 * appUrl is the local server URL (e.g. "http://127.0.0.1:4178").
 */
async function sendReminder(cfg, { appUrl }) {
  const userId = requireSlack(cfg, "studentUserId");

  const builderName = cfg.builder && cfg.builder.name ? cfg.builder.name.split(" ")[0] : "Hey";
  const text =
    `${builderName}, time for your daily Builder Log check-in!\n\n` +
    `Head to the web app and take 5 minutes to log what you built, decided, or learned today:\n` +
    `${appUrl}\n\n` +
    `(Your answers stay private — this just helps you think clearly and keeps your instructor in the loop.)`;

  const { channel, ts } = await sendToUser(userId, text);
  return { ok: true, channel, ts };
}

/**
 * sendInstructorNote(cfg, { date }) -> Promise<{ ok, channel, ts } | { ok, reason }>
 *
 * Read the instructor draft for `date` (from raw/instructor/<date>.md) and
 * DM it to the instructor. Returns { ok: false, reason } if there's nothing
 * to send (no file, or empty draft section).
 */
async function sendInstructorNote(cfg, { date, text: override } = {}) {
  const userId = requireSlack(cfg, "instructorUserId");

  const targetDate = date || today();
  const filePath = path.join(ROOT, "raw", "instructor", `${targetDate}.md`);

  // Prefer an explicit (student-edited) note; fall back to the latest drafted
  // section on disk. This is what lets the builder correct/soften the note
  // before it reaches a real person.
  let draft = (typeof override === "string" && override.trim()) ? override.trim() : null;
  if (!draft) {
    let content;
    try {
      content = fs.readFileSync(filePath, "utf8");
    } catch {
      return { ok: false, reason: "nothing to send" };
    }
    draft = extractLatestDraft(content);
  }
  if (!draft) return { ok: false, reason: "nothing to send" };

  // Record exactly what was sent (audit trail; also lets History show sent vs
  // draft-only). Append-only — never rewrites the original draft section.
  try {
    fs.appendFileSync(filePath, `\n## Sent to instructor — ${targetDate}\n${draft}\n`);
  } catch {
    // Non-fatal: the message still sends even if the audit append fails.
  }

  const builderName = (cfg.builder && cfg.builder.name) || "your builder";

  const text =
    `Builder Log update for ${targetDate} — from ${builderName}:\n\n` +
    `${draft}\n\n` +
    `---\n` +
    `_Sent via Builder Log. Reply here if you have feedback for ${builderName}._`;

  const { channel, ts } = await sendToUser(userId, text);
  return { ok: true, channel, ts };
}

/**
 * collectInstructorFeedback(cfg, state) -> Promise<{ channel, messages }>
 *
 * Read the instructor's replies since state.slack.instructorNoteTs (set when the
 * last note was sent). This is the return leg of the sync loop — the mentor's
 * feedback coming back into the app. Returns messages only; the caller stores
 * them and folds them into the instructor thread.
 */
async function collectInstructorFeedback(cfg, state) {
  const userId = requireSlack(cfg, "instructorUserId");

  const channel = await openDm(userId);
  const since = (state.slack && state.slack.instructorNoteTs) || "0";
  const messages = await historySince(channel, since);

  return { channel, messages };
}

/**
 * askInstructor(cfg) -> Promise<{ ok, channel, ts }>
 *
 * DM the 6 INSTRUCTOR_QUESTIONS to the instructor to collect their
 * preferences. For FUTURE use — not yet wired to the UI.
 */
async function askInstructor(cfg) {
  const userId = requireSlack(cfg, "instructorUserId");

  const builderName = (cfg.builder && cfg.builder.name) || "your builder";
  const numbered = INSTRUCTOR_QUESTIONS
    .map((q, i) => `${i + 1}. ${q}`)
    .join("\n\n");

  const text =
    `Hi! ${builderName} is setting up Builder Log and would love your input.\n\n` +
    `It's a quick tool that keeps a disciplined log of their work and sends you ` +
    `short, signal-only updates shaped around what *you* want to see.\n\n` +
    `Please answer the questions below in your own words:\n\n` +
    `${numbered}\n\n` +
    `Feel free to reply in any order, skip questions that don't apply, or just ` +
    `send a few words — any answer is better than the defaults.`;

  const { channel, ts } = await sendToUser(userId, text);
  return { ok: true, channel, ts };
}

/**
 * collectInstructorAnswers(cfg, state) -> Promise<{ channel, messages }>
 *
 * Read instructor replies since the timestamp stored in
 * state.slack.instructorAskedTs. RETURNS messages only — does not write to
 * state or config. Caller decides how to apply the answers.
 *
 * For FUTURE use — not yet wired to the UI.
 */
async function collectInstructorAnswers(cfg, state) {
  const userId = requireSlack(cfg, "instructorUserId");

  const channel = await openDm(userId);
  const since = (state.slack && state.slack.instructorAskedTs) || "0";
  const messages = await historySince(channel, since);

  return { channel, messages };
}

/**
 * askInstructorObjectives(cfg, { suggestions }) -> Promise<{ ok, channel, ts }>
 *
 * DM the instructor asking for this week's priorities, optionally seeded with a
 * short shortlist the agent proposed. The instructor replies in free text;
 * collectObjectiveReplies reads the answer.
 */
async function askInstructorObjectives(cfg, { suggestions } = {}) {
  const userId = requireSlack(cfg, "instructorUserId");

  const builderName = (cfg.builder && cfg.builder.name) || "your builder";
  const list = (suggestions || []).length
    ? `Here's a quick shortlist I'm seeing:\n${suggestions.map((s, i) => `${i + 1}. ${s}`).join("\n")}\n\n`
    : "";

  const text =
    `Setting this week's priorities for ${builderName}.\n\n` +
    `${list}` +
    `What should ${builderName} focus on this week? Reply with the priorities that matter — ` +
    `edit or add freely. A short, high-level list is perfect.`;

  const { channel, ts } = await sendToUser(userId, text);
  return { ok: true, channel, ts };
}

/**
 * collectObjectiveReplies(cfg, state) -> Promise<{ channel, messages }>
 *
 * Read instructor replies since state.slack.priorityAskedTs (set when the
 * objectives ask was sent). Returns messages only; caller parses + applies.
 */
async function collectObjectiveReplies(cfg, state) {
  const userId = requireSlack(cfg, "instructorUserId");

  const channel = await openDm(userId);
  const since = (state.slack && state.slack.priorityAskedTs) || "0";
  const messages = await historySince(channel, since);

  return { channel, messages };
}

/**
 * sendCheckinQuestions(cfg, { questions }) -> Promise<{ ok, channel, ts }>
 *
 * DM the BUILDER (studentUserId) the day's check-in questions so they can answer
 * in Slack instead of the web form. One message; the builder replies with their
 * answers, which collectCheckinReplies reads back.
 */
async function sendCheckinQuestions(cfg, { questions } = {}) {
  const userId = requireSlack(cfg, "studentUserId");

  const list = (questions || [])
    .map((q, i) => `${i + 1}. ${String(q).replace(/^\s*\d+[.)]\s*/, "")}`)
    .join("\n\n");

  const text =
    `Time for your Builder Log check-in. Reply to this message with your answers ` +
    `(one message is fine — just make clear which question each answer is for):\n\n${list}`;

  const { channel, ts } = await sendToUser(userId, text);
  return { ok: true, channel, ts };
}

/**
 * collectCheckinReplies(cfg, state) -> Promise<{ channel, messages }>
 *
 * Read the BUILDER's replies since state.slack.checkinAskedTs (set when the
 * questions were sent). Returns messages only; caller turns them into answers.
 */
async function collectCheckinReplies(cfg, state) {
  const userId = requireSlack(cfg, "studentUserId");

  const channel = await openDm(userId);
  const since = (state.slack && state.slack.checkinAskedTs) || "0";
  const messages = await historySince(channel, since);

  return { channel, messages };
}

/**
 * checkConnection() -> Promise<{ connected, reason?, message, team?, botUser?, botUserId? }>
 *
 * Non-throwing probe for the web UI: answers "is the Slack bot token wired up
 * and valid?". Independent of chatSurface and user IDs — it only verifies the
 * token via auth.test. Returns a structured status the UI can render directly,
 * never throws for the expected "not set / rejected" cases.
 */
async function checkConnection() {
  if (!process.env.SLACK_BOT_TOKEN) {
    return {
      connected: false,
      reason: "no-token",
      message:
        "SLACK_BOT_TOKEN is not set. Add it to your .env file, then restart the server.",
    };
  }
  try {
    const data = await authTest();
    return {
      connected: true,
      message: `Connected to ${data.team} as ${data.user}.`,
      team: data.team,
      botUser: data.user,
      botUserId: data.user_id,
    };
  } catch (e) {
    return {
      connected: false,
      reason: "auth-failed",
      message: `Slack rejected the token: ${e.message}`,
    };
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  sendReminder,
  sendInstructorNote,
  collectInstructorFeedback,
  askInstructor,
  collectInstructorAnswers,
  askInstructorObjectives,
  collectObjectiveReplies,
  sendCheckinQuestions,
  collectCheckinReplies,
  checkConnection,
};
