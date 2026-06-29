/*
 * test/templates.test.js — Prompt wording contract tests for src/templates/.
 *
 * Treats prompts as a tested contract (codojo-style): changing the wording of
 * a key element requires a conscious test-update, making accidental prompt drift
 * visible in CI. Zero LLM calls — we only check the strings we build.
 */

"use strict";

const { describe, test } = require("node:test");
const assert = require("node:assert/strict");

const {
  THESIS,
  askQuestions,
  extractFacts,
  synthesizeEntry,
  INSTRUCTOR_QUESTIONS,
  instructorDoc,
  projectPlanPrompt,
  PROJECT_PLAN_FORMAT,
} = require("../src/templates/index");

// ---------------------------------------------------------------------------
// THESIS
// ---------------------------------------------------------------------------

describe("THESIS", () => {
  test("contains 'record' (core principle)", () => {
    assert.ok(
      THESIS.toLowerCase().includes("record"),
      `THESIS must contain "record" — got: ${THESIS}`
    );
  });

  test("contains 'evidence' (evidence over activity)", () => {
    assert.ok(
      THESIS.toLowerCase().includes("evidence"),
      `THESIS must contain "evidence" — got: ${THESIS}`
    );
  });

  test("is a non-empty string", () => {
    assert.equal(typeof THESIS, "string");
    assert.ok(THESIS.length > 0);
  });

  test("instructs no emojis / no nag / no cheerlead", () => {
    const lower = THESIS.toLowerCase();
    // Must say what NOT to do as well as what to do
    assert.ok(lower.includes("nag") || lower.includes("lecture") || lower.includes("cheerlead"),
      "THESIS should call out what to avoid");
  });
});

// ---------------------------------------------------------------------------
// askQuestions
// ---------------------------------------------------------------------------

describe("askQuestions", () => {
  const deltaText = "### src/core.js (modified)\nconsole.log('hello');";

  function makePrompt(overrides = {}) {
    return askQuestions(
      Object.assign(
        {
          thesis: THESIS,
          objectives: [{ text: "ship onboarding", done: false }],
          blockers: [{ text: "API rate limit" }],
          deltaText,
          deleted: [],
        },
        overrides
      )
    );
  }

  const prompt = makePrompt();

  test("starts with THESIS", () => {
    assert.ok(prompt.startsWith(THESIS), "prompt should start with THESIS");
  });

  test("asks for SPECIFIC questions (not generic)", () => {
    assert.ok(
      prompt.toUpperCase().includes("SPECIFIC"),
      `should ask for SPECIFIC questions; got excerpt: ${prompt.slice(0, 200)}`
    );
  });

  test("asks for evidence vs activity", () => {
    assert.ok(
      prompt.toLowerCase().includes("evidence"),
      "should ask for evidence of progress"
    );
  });

  test("asks for questions grounded in concrete file content", () => {
    const lower = prompt.toLowerCase();
    assert.ok(
      lower.includes("concrete") || lower.includes("ground"),
      "should ask for grounded/concrete questions"
    );
  });

  test("requests numbered list output only", () => {
    assert.ok(
      prompt.toLowerCase().includes("numbered"),
      "should request a numbered list"
    );
  });

  test("embeds this week's objectives", () => {
    assert.ok(prompt.includes("objectives"), "should label objectives");
    assert.ok(prompt.includes("ship onboarding"), "should embed objective text");
  });

  test("embeds the delta text", () => {
    assert.ok(prompt.includes("src/core.js"), "should embed delta file name");
  });

  test("includes deleted files line when deleted is non-empty", () => {
    const p = makePrompt({ deleted: ["old/file.txt"] });
    assert.ok(p.includes("old/file.txt"), "should list deleted files");
  });

  test("omits deleted line when deleted array is empty", () => {
    const p = makePrompt({ deleted: [] });
    assert.ok(!p.includes("Deleted:"), "should not include Deleted: line when empty");
  });
});

// ---------------------------------------------------------------------------
// extractFacts
// ---------------------------------------------------------------------------

describe("extractFacts", () => {
  function makePrompt(overrides = {}) {
    return extractFacts(
      Object.assign(
        {
          thesis: THESIS,
          date: "2024-01-10",
          objectives: [{ text: "ship the API", done: false }],
          chat: "Q: What did you build?\nA: A new API endpoint.",
          changedFiles: ["src/server.js"],
        },
        overrides
      )
    );
  }

  const prompt = makePrompt();

  test("starts with THESIS", () => {
    assert.ok(prompt.startsWith(THESIS));
  });

  test("requests STRICT JSON output (no prose, no code fence)", () => {
    assert.ok(
      prompt.includes("STRICT JSON"),
      `should request STRICT JSON; got: ${prompt.slice(0, 300)}`
    );
    const lower = prompt.toLowerCase();
    assert.ok(lower.includes("no prose"), "should say no prose");
    assert.ok(lower.includes("no code fence"), "should say no code fence");
  });

  test("schema includes 'progress' field", () => {
    assert.ok(prompt.includes('"progress"'), 'schema must include "progress"');
  });

  test("schema includes 'resolvedObjectives' field", () => {
    assert.ok(prompt.includes('"resolvedObjectives"'), 'schema must include "resolvedObjectives"');
  });

  test("schema includes 'blockers' field", () => {
    assert.ok(prompt.includes('"blockers"'), 'schema must include "blockers"');
  });

  test("schema includes 'summary' field", () => {
    assert.ok(prompt.includes('"summary"'), 'schema must include "summary"');
  });

  test("specifies real evidence required (not mere intent)", () => {
    const lower = prompt.toLowerCase();
    assert.ok(
      lower.includes("evidence") || lower.includes("real evidence"),
      "should require real evidence for resolution"
    );
  });

  test("includes the today date", () => {
    assert.ok(prompt.includes("2024-01-10"), "should include the date");
  });

  test("embeds this week's objectives", () => {
    assert.ok(prompt.includes("ship the API"), "should embed objective text");
  });

  test("includes the chat content", () => {
    assert.ok(prompt.includes("What did you build"), "should include interview content");
  });

  test("includes changed files", () => {
    assert.ok(prompt.includes("src/server.js"), "should include changed files");
  });

  test("includes 'none' when no changed files", () => {
    const p = makePrompt({ changedFiles: [] });
    assert.ok(p.includes("none"), "should say none when no files changed");
  });
});

// ---------------------------------------------------------------------------
// synthesizeEntry
// ---------------------------------------------------------------------------

describe("synthesizeEntry", () => {
  const defaultPrefsNote =
    "(NOTE: these are DEFAULT preferences — the actual instructor has not customized them yet.)";

  function makeHistoryCtx(withDefaultNote = true) {
    return (
      "HISTORY CONTEXT (raw accumulated facts):\n" +
      "- Open commitments: none\n" +
      "- Blockers seen: none\n" +
      `Instructor cares about: evidence of real progress.` +
      (withDefaultNote ? " " + defaultPrefsNote : "") +
      "\n"
    );
  }

  function makePrompt(overrides = {}) {
    return synthesizeEntry(
      Object.assign(
        {
          thesis: THESIS,
          historyContext: makeHistoryCtx(),
          work: { files: { "src/core.js": { change: "modified" } } },
          chat: "Q: What did you do?\nA: Fixed a bug in the extractor.",
        },
        overrides
      )
    );
  }

  const prompt = makePrompt();

  test("starts with THESIS", () => {
    assert.ok(prompt.startsWith(THESIS));
  });

  test("contains '## Builder Log' section header", () => {
    assert.ok(
      prompt.includes("## Builder Log"),
      "must include ## Builder Log section header"
    );
  });

  test("contains '## For your instructor' section header", () => {
    assert.ok(
      prompt.includes("## For your instructor"),
      "must include ## For your instructor section header"
    );
  });

  test("contains '## Friction check' section header", () => {
    assert.ok(
      prompt.includes("## Friction check"),
      "must include ## Friction check section header"
    );
  });

  test("includes the historyContext (with default-prefs note when provided)", () => {
    assert.ok(
      prompt.includes("DEFAULT preferences"),
      "should propagate default-prefs note from historyContext"
    );
  });

  test("includes evidence sub-heading in Builder Log", () => {
    const lower = prompt.toLowerCase();
    assert.ok(lower.includes("evidence"), "Builder Log section should mention evidence");
  });

  test("instructs 'never invent evidence'", () => {
    const lower = prompt.toLowerCase();
    assert.ok(
      lower.includes("never invent") || lower.includes("never manufacture"),
      "should instruct not to invent evidence"
    );
  });

  test("triage section caps at 1-3 items", () => {
    assert.ok(
      prompt.includes("1 to 3") || prompt.includes("1–3") || prompt.includes("1-3"),
      "instructor section should be capped at 1-3 items"
    );
  });

  test("includes the work delta files JSON", () => {
    assert.ok(prompt.includes("src/core.js"), "should include work file names");
  });

  test("includes the interview content", () => {
    assert.ok(prompt.includes("Fixed a bug"), "should include interview answers");
  });

  test("handles null work.files gracefully", () => {
    const p = makePrompt({ work: null });
    assert.ok(p.includes("## Builder Log"), "should still have section headers");
  });

  test("without default-prefs note, prompt does not contain the note text", () => {
    const p = makePrompt({ historyContext: makeHistoryCtx(false) });
    assert.ok(!p.includes("DEFAULT preferences"),
      "should NOT include default-prefs note when not in historyContext");
  });
});

// ---------------------------------------------------------------------------
// projectPlanPrompt
// ---------------------------------------------------------------------------

describe("projectPlanPrompt", () => {
  const cfg = {
    builder: { project: "A PBL tool", context: "solo" },
    instructor: { currentGoal: "ship MVP" },
  };

  test("embeds the canonical format headings", () => {
    const p = projectPlanPrompt({ cfg, dirs: [{ path: "/x", label: "x" }] });
    for (const h of ["## Vision", "## Milestones", "## Workstreams", "## Where things live"]) {
      assert.ok(p.includes(h), `should include ${h}`);
      assert.ok(PROJECT_PLAN_FORMAT.includes(h));
    }
  });

  test("existing mode forbids restructuring; scaffold mode proposes layout", () => {
    const existing = projectPlanPrompt({ cfg, dirs: ["/x"], mode: "existing" });
    assert.match(existing.toLowerCase(), /do not propose moving|restructuring/);
    const scaffold = projectPlanPrompt({ cfg, dirs: [], mode: "scaffold" });
    assert.match(scaffold.toLowerCase(), /propose a (simple )?folder layout|starting fresh/);
  });

  test("embeds project + dirs", () => {
    const p = projectPlanPrompt({ cfg, dirs: [{ path: "/repo", label: "repo" }] });
    assert.ok(p.includes("A PBL tool"));
    assert.ok(p.includes("/repo"));
  });
});

// ---------------------------------------------------------------------------
// INSTRUCTOR_QUESTIONS
// ---------------------------------------------------------------------------

describe("INSTRUCTOR_QUESTIONS", () => {
  test("is an array of 6 questions", () => {
    assert.ok(Array.isArray(INSTRUCTOR_QUESTIONS));
    assert.equal(INSTRUCTOR_QUESTIONS.length, 6);
  });

  test("every item is a non-empty string", () => {
    for (const q of INSTRUCTOR_QUESTIONS) {
      assert.equal(typeof q, "string");
      assert.ok(q.length > 0);
    }
  });

  test("includes a question about real evidence / progress", () => {
    const joined = INSTRUCTOR_QUESTIONS.join(" ").toLowerCase();
    assert.ok(
      joined.includes("evidence") || joined.includes("progress"),
      "should have a question about evidence or progress"
    );
  });

  test("includes a question about what to flag early", () => {
    const joined = INSTRUCTOR_QUESTIONS.join(" ").toLowerCase();
    assert.ok(
      joined.includes("flag") || joined.includes("early"),
      "should include a question about what to flag early"
    );
  });
});

// ---------------------------------------------------------------------------
// instructorDoc
// ---------------------------------------------------------------------------

describe("instructorDoc", () => {
  test("generates a string with all 6 questions", () => {
    const doc = instructorDoc({ builder: { name: "Alice", project: "StudyMatch" }, instructor: { name: "Dr. Smith" } });
    assert.equal(typeof doc, "string");
    assert.ok(doc.length > 0);
    // All 6 questions numbered
    for (let i = 1; i <= 6; i++) {
      assert.ok(doc.includes(`${i}.`), `should include question ${i}`);
    }
  });

  test("includes builder name", () => {
    const doc = instructorDoc({ builder: { name: "Alice" } });
    assert.ok(doc.includes("Alice"), "should mention the builder name");
  });

  test("includes instructor name", () => {
    const doc = instructorDoc({ instructor: { name: "Dr. Smith" } });
    assert.ok(doc.includes("Dr. Smith"), "should mention the instructor name");
  });

  test("works with null/undefined cfg (uses defaults)", () => {
    const doc = instructorDoc(null);
    assert.ok(typeof doc === "string" && doc.length > 0, "should not throw with null cfg");
  });
});
