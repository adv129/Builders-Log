/*
 * test/slack.test.js — Slack connector + actions: fake-server tests.
 *
 * Verifies sendReminder and sendInstructorNote build correct Slack API
 * calls and include the expected content (appUrl / draft text), with
 * ZERO real Slack traffic.
 *
 * Strategy:
 *   1. Start a local fake Slack server (random port) before any tests run.
 *   2. Set SLACK_API_BASE + SLACK_BOT_TOKEN env vars *before* requiring the
 *      connector module, so the module-level BASE constant captures the fake URL.
 *   3. Dynamically require src/slack-actions inside the before() hook.
 *   4. After all tests, shut down the fake server.
 *
 * No network traffic beyond 127.0.0.1.
 */

"use strict";

const { describe, test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const net = require("net");
const fs = require("fs");
const path = require("path");

// plan.js has no Slack/env dependency — safe to require at top.
const { parseObjectiveReply } = require("../src/plan");

// ── helpers ───────────────────────────────────────────────────────────────────

/** Resolve a free TCP port on 127.0.0.1. */
function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const p = s.address().port;
      s.close((e) => (e ? reject(e) : resolve(p)));
    });
  });
}

// ── suite ─────────────────────────────────────────────────────────────────────

describe("Slack actions against fake Slack server", () => {
  let sendReminder, sendInstructorNote, collectObjectiveReplies, collectCheckinReplies;
  let fakeSlack;
  let fakePort;
  // Mutable array — tests clear it before each assertion round.
  const captured = [];
  // Mutable conversation history the fake /conversations.history returns.
  let history = [];

  // ── fake server setup ──────────────────────────────────────────────────────

  before(async () => {
    fakePort = await freePort();

    fakeSlack = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        // Collect call details for assertions.
        let parsed = {};
        try { if (body) parsed = JSON.parse(body); } catch {}
        const endpoint = req.url.split("?")[0]; // e.g. "/conversations.open"
        captured.push({ method: req.method, endpoint, body: parsed, rawUrl: req.url });

        // Fake responses keyed by endpoint.
        let resp = { ok: true };
        switch (endpoint) {
          case "/conversations.open":
            resp.channel = { id: "DM-FAKE-123" };
            break;
          case "/chat.postMessage":
            resp.ts = "1700000000.000001";
            break;
          case "/auth.test":
            resp.user_id = "BOT-FAKE-U000";
            break;
          case "/conversations.history":
            resp.messages = history;
            resp.has_more = false;
            break;
        }

        const payload = JSON.stringify(resp);
        res.writeHead(200, {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        });
        res.end(payload);
      });
    });

    await new Promise((resolve, reject) =>
      fakeSlack.listen(fakePort, "127.0.0.1", (e) => (e ? reject(e) : resolve()))
    );

    // CRITICAL: set env vars BEFORE requiring the connector module.
    // The connector captures BASE = process.env.SLACK_API_BASE at load time.
    process.env.SLACK_API_BASE = `http://127.0.0.1:${fakePort}`;
    process.env.SLACK_BOT_TOKEN = "xoxb-fake-test-token";

    // Dynamic require — loads fresh with the env vars already set above.
    ({ sendReminder, sendInstructorNote, collectObjectiveReplies, collectCheckinReplies } =
      require("../src/slack-actions"));
  });

  after(async () => {
    await new Promise((resolve, reject) =>
      fakeSlack.close((e) => (e ? reject(e) : resolve()))
    );
  });

  // ── shared mock config ─────────────────────────────────────────────────────

  function mockCfg(overrides = {}) {
    return Object.assign(
      {
        chatSurface: "slack",
        slack: {
          studentUserId: "U-STUDENT-001",
          instructorUserId: "U-INSTRUCTOR-002",
          gateInstructorMessages: true,
        },
        builder: { name: "Maya Chen", project: "StudyMatch" },
        instructor: { name: "Dr. Smith" },
      },
      overrides
    );
  }

  // ── sendReminder tests ─────────────────────────────────────────────────────

  test("sendReminder — opens DM with studentUserId and posts message containing appUrl", async () => {
    captured.length = 0;

    const appUrl = "http://127.0.0.1:4178";
    const result = await sendReminder(mockCfg(), { appUrl });

    assert.equal(result.ok, true, "result.ok should be true");
    assert.equal(result.ts, "1700000000.000001", "result.ts should match fake server ts");
    assert.equal(result.channel, "DM-FAKE-123", "result.channel should match fake DM id");

    // conversations.open called with the student user ID
    const openCall = captured.find((c) => c.endpoint === "/conversations.open");
    assert.ok(openCall, "conversations.open must have been called");
    assert.equal(
      openCall.body.users,
      "U-STUDENT-001",
      "conversations.open must use studentUserId"
    );

    // chat.postMessage called with correct channel and includes appUrl
    const postCall = captured.find((c) => c.endpoint === "/chat.postMessage");
    assert.ok(postCall, "chat.postMessage must have been called");
    assert.equal(postCall.body.channel, "DM-FAKE-123", "postMessage channel must be the opened DM");
    assert.ok(
      postCall.body.text.includes(appUrl),
      `message text must include the appUrl ("${appUrl}"); got: ${postCall.body.text}`
    );

    // No real Slack traffic — only two calls to our fake server
    const slackCalls = captured.filter(
      (c) => c.endpoint === "/conversations.open" || c.endpoint === "/chat.postMessage"
    );
    assert.equal(slackCalls.length, 2, "should be exactly 2 Slack API calls");
  });

  test("sendReminder — throws when chatSurface is not 'slack'", async () => {
    captured.length = 0;

    await assert.rejects(
      () => sendReminder(mockCfg({ chatSurface: "terminal" }), { appUrl: "http://127.0.0.1:4178" }),
      /chatSurface/,
      "should throw referencing chatSurface"
    );

    // No Slack calls should have been made
    assert.equal(captured.length, 0, "no Slack API calls should be made when guard fails");
  });

  test("sendReminder — throws when studentUserId is missing", async () => {
    captured.length = 0;

    const cfg = mockCfg();
    cfg.slack.studentUserId = null;

    await assert.rejects(
      () => sendReminder(cfg, { appUrl: "http://127.0.0.1:4178" }),
      /studentUserId/,
      "should throw referencing studentUserId"
    );

    assert.equal(captured.length, 0, "no Slack API calls when guard fails");
  });

  // ── sendInstructorNote tests ───────────────────────────────────────────────

  test("sendInstructorNote — returns {ok:false} when no instructor file exists", async () => {
    captured.length = 0;

    // Use a date that will definitely have no file (far past)
    const result = await sendInstructorNote(mockCfg(), { date: "1900-01-01" });

    assert.equal(result.ok, false, "result.ok should be false");
    assert.equal(result.reason, "nothing to send", "reason should be 'nothing to send'");

    // Must not have contacted Slack at all
    assert.equal(captured.length, 0, "no Slack API calls when nothing to send");
  });

  test("sendInstructorNote — posts draft text to instructorUserId when file exists", async () => {
    captured.length = 0;

    // Create a temp instructor file in the real project raw/instructor/ dir
    // (uses the same ROOT that slack-actions.js uses, so the paths match).
    const ROOT = path.resolve(__dirname, "..");
    const instrDir = path.join(ROOT, "raw", "instructor");
    fs.mkdirSync(instrDir, { recursive: true });

    const testDate = "1900-01-15"; // far-past date — no collision with real data
    const draftPath = path.join(instrDir, `${testDate}.md`);
    const draftText =
      "Maya is making strong progress on the matching algorithm. " +
      "Potential blocker: needs a DB schema decision by end of week.";

    fs.writeFileSync(
      draftPath,
      `\n## Draft for instructor (outbound) — ${testDate}\n${draftText}\n`
    );

    let result;
    try {
      result = await sendInstructorNote(mockCfg(), { date: testDate });
    } finally {
      // Always clean up the test file
      try { fs.unlinkSync(draftPath); } catch {}
    }

    assert.equal(result.ok, true, "result.ok should be true");
    assert.equal(result.ts, "1700000000.000001", "result.ts should match fake server ts");

    // conversations.open should be called with the *instructor* user ID
    const openCall = captured.find((c) => c.endpoint === "/conversations.open");
    assert.ok(openCall, "conversations.open must have been called");
    assert.equal(
      openCall.body.users,
      "U-INSTRUCTOR-002",
      "conversations.open must use instructorUserId (not studentUserId)"
    );

    // chat.postMessage must include the draft text
    const postCall = captured.find((c) => c.endpoint === "/chat.postMessage");
    assert.ok(postCall, "chat.postMessage must have been called");
    assert.ok(
      postCall.body.text.includes(draftText),
      `message must contain the draft text; got: ${postCall.body.text}`
    );
  });

  test("sendInstructorNote — picks up the LATEST draft when file has multiple appended drafts", async () => {
    captured.length = 0;

    const ROOT = path.resolve(__dirname, "..");
    const instrDir = path.join(ROOT, "raw", "instructor");
    fs.mkdirSync(instrDir, { recursive: true });

    const testDate = "1900-02-01";
    const draftPath = path.join(instrDir, `${testDate}.md`);

    const firstDraft = "First draft — should NOT be sent.";
    const latestDraft = "Second draft — THIS is the one that should be sent.";

    // Simulate two appends (as core.js does)
    const content =
      `\n## Draft for instructor (outbound) — ${testDate}\n${firstDraft}\n` +
      `\n## Draft for instructor (outbound) — ${testDate}\n${latestDraft}\n`;

    fs.writeFileSync(draftPath, content);

    let result;
    try {
      result = await sendInstructorNote(mockCfg(), { date: testDate });
    } finally {
      try { fs.unlinkSync(draftPath); } catch {}
    }

    assert.equal(result.ok, true);

    const postCall = captured.find((c) => c.endpoint === "/chat.postMessage");
    assert.ok(postCall, "chat.postMessage must have been called");
    assert.ok(
      postCall.body.text.includes(latestDraft),
      "message must include the LATEST draft text"
    );
    assert.ok(
      !postCall.body.text.includes(firstDraft),
      "message must NOT include the earlier draft"
    );
  });

  // ── multi-message intake (the "Sync with Slack" pull) ──────────────────────

  test("collectObjectiveReplies — intakes ALL instructor messages, oldest-first, excluding the bot", async () => {
    captured.length = 0;
    // Three real instructor messages (split reply) + one bot message to exclude.
    // Deliberately out of order to prove oldest-first sorting.
    history = [
      { ts: "1700000006.000002", user: "U-INSTRUCTOR-002", text: "2. Wire Slack\n3. Polish UI" },
      { ts: "1700000004.000000", user: "BOT-FAKE-U000", subtype: "bot_message", text: "What are the priorities?" },
      { ts: "1700000005.000001", user: "U-INSTRUCTOR-002", text: "1. Ship onboarding" },
    ];

    const state = { slack: { priorityAskedTs: "1700000004.000000" } };
    const { messages } = await collectObjectiveReplies(mockCfg(), state);

    // All instructor messages, bot excluded, oldest-first.
    assert.equal(messages.length, 2, "should return both instructor messages, not just the latest");
    assert.equal(messages[0].text, "1. Ship onboarding", "oldest message first");
    assert.equal(messages[1].text, "2. Wire Slack\n3. Polish UI");

    // The server route combines all messages then parses — every line survives.
    const text = messages.map((m) => m.text).filter(Boolean).join("\n").trim();
    const items = parseObjectiveReply(text);
    assert.deepEqual(items, ["Ship onboarding", "Wire Slack", "Polish UI"],
      "all objectives from all messages intaken, not just the last message");
  });

  test("collectCheckinReplies — intakes ALL builder messages since the ask", async () => {
    captured.length = 0;
    history = [
      { ts: "1700000011.000001", user: "U-STUDENT-001", text: "Answer 1: built the parser." },
      { ts: "1700000012.000002", user: "U-STUDENT-001", text: "Answer 2: tested it." },
      { ts: "1700000013.000003", user: "U-STUDENT-001", text: "Answer 3: no blockers." },
    ];

    const state = { slack: { checkinAskedTs: "1700000010.000000" } };
    const { messages } = await collectCheckinReplies(mockCfg(), state);

    assert.equal(messages.length, 3, "should return all three builder messages");
    // The route joins them into the answers blob fed to runSync.
    const blob = messages.map((m) => m.text).filter(Boolean).join("\n\n");
    assert.ok(blob.includes("Answer 1") && blob.includes("Answer 2") && blob.includes("Answer 3"),
      "all builder messages present in the combined answers");
  });
});
