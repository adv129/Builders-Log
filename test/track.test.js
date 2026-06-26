/*
 * test/track.test.js — Pure logic tests for src/track.js.
 *
 * Covers: applyExtraction (resolve, carry, dedupe, blocker recurrence),
 * bumpChurn, historyView shape, daysSince, nextId, norm.
 * Zero LLM calls — all pure function tests.
 */

"use strict";

const { describe, test } = require("node:test");
const assert = require("node:assert/strict");

const {
  daysSince,
  nextId,
  norm,
  applyExtraction,
  bumpChurn,
  historyView,
} = require("../src/track");

// ---------------------------------------------------------------------------
// daysSince
// ---------------------------------------------------------------------------

describe("daysSince", () => {
  test("returns 0 for same day", () => {
    assert.equal(daysSince("2024-01-01", "2024-01-01"), 0);
  });

  test("returns correct positive days difference", () => {
    assert.equal(daysSince("2024-01-01", "2024-01-08"), 7);
  });

  test("returns 0 for null dateStr", () => {
    assert.equal(daysSince(null, "2024-01-01"), 0);
  });

  test("returns 0 for undefined dateStr", () => {
    assert.equal(daysSince(undefined, "2024-01-01"), 0);
  });

  test("handles crossing month boundary", () => {
    assert.equal(daysSince("2024-01-28", "2024-02-04"), 7);
  });
});

// ---------------------------------------------------------------------------
// nextId
// ---------------------------------------------------------------------------

describe("nextId", () => {
  test("returns c1 for empty list", () => {
    assert.equal(nextId([]), "c1");
  });

  test("returns next after highest numeric id", () => {
    const commitments = [{ id: "c1" }, { id: "c3" }, { id: "c2" }];
    assert.equal(nextId(commitments), "c4");
  });

  test("ignores non-cN ids (e.g. 'foo')", () => {
    assert.equal(nextId([{ id: "foo" }]), "c1");
  });

  test("ignores entries without id", () => {
    assert.equal(nextId([{}]), "c1");
  });

  test("handles large ids", () => {
    assert.equal(nextId([{ id: "c100" }]), "c101");
  });
});

// ---------------------------------------------------------------------------
// norm
// ---------------------------------------------------------------------------

describe("norm", () => {
  test("lowercases and strips punctuation", () => {
    assert.equal(norm("Hello, World!"), "hello world");
  });

  test("collapses internal whitespace", () => {
    assert.equal(norm("  add  logging  "), "add logging");
  });

  test("handles null", () => {
    assert.equal(norm(null), "");
  });

  test("handles undefined", () => {
    assert.equal(norm(undefined), "");
  });

  test("handles empty string", () => {
    assert.equal(norm(""), "");
  });

  test("strips special characters", () => {
    assert.equal(norm("write-tests: (ASAP)"), "writetests asap");
  });
});

// ---------------------------------------------------------------------------
// applyExtraction
// ---------------------------------------------------------------------------

describe("applyExtraction — resolve with evidence", () => {
  test("marks commitment done when resolved with evidence", () => {
    const state = {
      commitments: [{ id: "c1", text: "write tests", status: "open" }],
      blockers: [],
    };
    applyExtraction(
      state,
      { resolved: [{ id: "c1", evidence: "tests passing" }], newCommitments: [], blockers: [] },
      "2024-01-10"
    );
    const c = state.commitments.find((c) => c.id === "c1");
    assert.equal(c.status, "done", "status must be done");
    assert.equal(c.evidence, "tests passing", "evidence must be stored");
    assert.equal(c.resolvedOn, "2024-01-10", "resolvedOn must be set");
  });

  test("does not re-resolve an already-done commitment", () => {
    const state = {
      commitments: [{ id: "c1", text: "write tests", status: "done", resolvedOn: "2024-01-05" }],
      blockers: [],
    };
    applyExtraction(
      state,
      { resolved: [{ id: "c1", evidence: "again" }] },
      "2024-01-10"
    );
    assert.equal(state.commitments[0].resolvedOn, "2024-01-05", "resolvedOn must not change");
  });

  test("uses 'done' as fallback evidence when evidence is empty", () => {
    const state = {
      commitments: [{ id: "c1", text: "thing", status: "open" }],
      blockers: [],
    };
    applyExtraction(state, { resolved: [{ id: "c1", evidence: "" }] }, "2024-01-10");
    assert.equal(state.commitments[0].evidence, "done");
  });
});

describe("applyExtraction — carry open commitments", () => {
  test("increments carried for every open commitment", () => {
    const state = {
      commitments: [
        { id: "c1", text: "write docs", status: "open", carried: 0 },
        { id: "c2", text: "deploy", status: "open", carried: 2 },
      ],
      blockers: [],
    };
    applyExtraction(state, {}, "2024-01-10");
    assert.equal(state.commitments[0].carried, 1);
    assert.equal(state.commitments[1].carried, 3);
  });

  test("does not carry done commitments", () => {
    const state = {
      commitments: [
        { id: "c1", text: "done thing", status: "done", carried: 0 },
      ],
      blockers: [],
    };
    applyExtraction(state, {}, "2024-01-10");
    assert.equal(state.commitments[0].carried, 0, "done commitments must not be carried");
  });
});

describe("applyExtraction — dedupe new commitments", () => {
  test("does not add commitment whose normalized text matches an open one", () => {
    const state = {
      commitments: [{ id: "c1", text: "add logging", status: "open", carried: 0 }],
      blockers: [],
    };
    applyExtraction(
      state,
      { newCommitments: [{ text: "Add Logging!" }] },
      "2024-01-10"
    );
    // Still just 1 — the carried loop runs but does not re-add
    assert.equal(
      state.commitments.filter((c) => c.status === "open").length,
      1,
      "duplicate (by normalized text) must not be added"
    );
  });

  test("adds a new commitment whose text is distinct", () => {
    const state = { commitments: [], blockers: [] };
    applyExtraction(
      state,
      { newCommitments: [{ text: "write tests", due: "2024-02-01" }] },
      "2024-01-10"
    );
    assert.equal(state.commitments.length, 1);
    assert.equal(state.commitments[0].status, "open");
    assert.equal(state.commitments[0].text, "write tests");
    assert.equal(state.commitments[0].due, "2024-02-01");
    assert.equal(state.commitments[0].openedOn, "2024-01-10");
    assert.equal(state.commitments[0].carried, 0);
  });

  test("dedupes against open, NOT done — can re-add a previously completed commitment", () => {
    const state = {
      commitments: [{ id: "c1", text: "write tests", status: "done" }],
      blockers: [],
    };
    applyExtraction(
      state,
      { newCommitments: [{ text: "write tests" }] },
      "2024-01-10"
    );
    // One done + one new open = 2 total
    assert.equal(state.commitments.length, 2, "should add even if done version exists");
    assert.equal(state.commitments[1].status, "open");
  });

  test("skips newCommitments entries with no text", () => {
    const state = { commitments: [], blockers: [] };
    applyExtraction(
      state,
      { newCommitments: [null, { text: "" }, { text: "valid one" }] },
      "2024-01-10"
    );
    assert.equal(state.commitments.length, 1, "only the valid commitment added");
  });
});

describe("applyExtraction — blocker recurrence", () => {
  test("increments count on recurring blocker", () => {
    const state = {
      commitments: [],
      blockers: [{ text: "DB not ready", count: 1, firstSeen: "2024-01-01", lastSeen: "2024-01-01" }],
    };
    applyExtraction(state, { blockers: ["DB not ready"] }, "2024-01-10");
    assert.equal(state.blockers[0].count, 2);
    assert.equal(state.blockers[0].lastSeen, "2024-01-10");
    assert.equal(state.blockers[0].firstSeen, "2024-01-01", "firstSeen must not change");
  });

  test("matches blocker recurrence by normalized text (case-insensitive, punctuation-stripped)", () => {
    const state = {
      commitments: [],
      blockers: [{ text: "DB not ready", count: 1, firstSeen: "2024-01-01", lastSeen: "2024-01-01" }],
    };
    applyExtraction(state, { blockers: ["db NOT ready!"] }, "2024-01-10");
    assert.equal(state.blockers[0].count, 2, "should match by normalized text");
  });

  test("adds new blocker with count 1 when not seen before", () => {
    const state = { commitments: [], blockers: [] };
    applyExtraction(state, { blockers: ["API timeout"] }, "2024-01-10");
    assert.equal(state.blockers.length, 1);
    assert.equal(state.blockers[0].count, 1);
    assert.equal(state.blockers[0].firstSeen, "2024-01-10");
    assert.equal(state.blockers[0].lastSeen, "2024-01-10");
  });

  test("skips null/falsy blockers", () => {
    const state = { commitments: [], blockers: [] };
    applyExtraction(state, { blockers: [null, "", "real blocker"] }, "2024-01-10");
    assert.equal(state.blockers.length, 1, "only truthy blockers added");
    assert.equal(state.blockers[0].text, "real blocker");
  });
});

describe("applyExtraction — initializes missing state keys", () => {
  test("creates commitments and blockers arrays if missing", () => {
    const state = {};
    applyExtraction(state, {}, "2024-01-10");
    assert.ok(Array.isArray(state.commitments));
    assert.ok(Array.isArray(state.blockers));
  });
});

// ---------------------------------------------------------------------------
// bumpChurn
// ---------------------------------------------------------------------------

describe("bumpChurn", () => {
  test("increments file change count on first encounter", () => {
    const state = {};
    bumpChurn(state, ["src/core.js"]);
    assert.equal(state.fileChurn["src/core.js"], 1);
  });

  test("accumulates on multiple calls", () => {
    const state = {};
    bumpChurn(state, ["src/core.js", "src/track.js"]);
    bumpChurn(state, ["src/core.js"]);
    assert.equal(state.fileChurn["src/core.js"], 2);
    assert.equal(state.fileChurn["src/track.js"], 1);
  });

  test("handles empty array", () => {
    const state = {};
    bumpChurn(state, []);
    assert.deepEqual(state.fileChurn, {});
  });

  test("handles null/undefined changedFiles", () => {
    const state = {};
    bumpChurn(state, null);
    assert.deepEqual(state.fileChurn, {});
  });

  test("initializes fileChurn if missing from state", () => {
    const state = {};
    bumpChurn(state, ["a.txt"]);
    assert.ok(state.fileChurn, "fileChurn should be created");
  });
});

// ---------------------------------------------------------------------------
// historyView
// ---------------------------------------------------------------------------

describe("historyView", () => {
  function makeState(overrides = {}) {
    return Object.assign(
      {
        commitments: [
          {
            id: "c1",
            text: "write tests",
            status: "open",
            openedOn: "2024-01-01",
            carried: 2,
            due: "2024-02-01",
            evidence: null,
          },
          {
            id: "c2",
            text: "deploy to prod",
            status: "done",
            openedOn: "2024-01-01",
            carried: 0,
            due: null,
            evidence: "deployed successfully",
          },
        ],
        blockers: [
          { text: "DB latency", count: 3, firstSeen: "2024-01-05", lastSeen: "2024-01-07" },
        ],
        fileChurn: { "src/core.js": 5, "src/track.js": 2 },
      },
      overrides
    );
  }

  test("returns openCommitments, blockers, churn arrays", () => {
    const view = historyView(makeState(), "2024-01-10");
    assert.ok(Array.isArray(view.openCommitments), "openCommitments is array");
    assert.ok(Array.isArray(view.blockers), "blockers is array");
    assert.ok(Array.isArray(view.churn), "churn is array");
  });

  test("excludes done commitments from openCommitments", () => {
    const view = historyView(makeState(), "2024-01-10");
    assert.equal(view.openCommitments.length, 1);
    assert.equal(view.openCommitments[0].id, "c1");
  });

  test("openCommitments item has expected fields", () => {
    const view = historyView(makeState(), "2024-01-10");
    const c = view.openCommitments[0];
    assert.equal(c.id, "c1");
    assert.equal(c.text, "write tests");
    assert.equal(c.openedOn, "2024-01-01");
    assert.equal(c.daysOpen, 9);
    assert.equal(c.carried, 2);
    assert.equal(c.due, "2024-02-01");
    assert.equal(c.hasEvidence, false);
  });

  test("hasEvidence is true when evidence is set", () => {
    const state = makeState();
    state.commitments[0].evidence = "some evidence";
    const view = historyView(state, "2024-01-10");
    assert.equal(view.openCommitments[0].hasEvidence, true);
  });

  test("blockers projection has expected fields", () => {
    const view = historyView(makeState(), "2024-01-10");
    assert.equal(view.blockers[0].text, "DB latency");
    assert.equal(view.blockers[0].count, 3);
    assert.equal(view.blockers[0].firstSeen, "2024-01-05");
    assert.equal(view.blockers[0].lastSeen, "2024-01-07");
  });

  test("churn projection has file and changes fields", () => {
    const view = historyView(makeState(), "2024-01-10");
    assert.equal(view.churn.length, 2);
    const coreEntry = view.churn.find((c) => c.file === "src/core.js");
    assert.ok(coreEntry, "should have src/core.js in churn");
    assert.equal(coreEntry.changes, 5);
  });

  test("empty state returns empty arrays", () => {
    const state = { commitments: [], blockers: [], fileChurn: {} };
    const view = historyView(state, "2024-01-10");
    assert.equal(view.openCommitments.length, 0);
    assert.equal(view.blockers.length, 0);
    assert.equal(view.churn.length, 0);
  });

  test("handles missing state keys gracefully", () => {
    const view = historyView({}, "2024-01-10");
    assert.equal(view.openCommitments.length, 0);
    assert.equal(view.blockers.length, 0);
    assert.equal(view.churn.length, 0);
  });
});
