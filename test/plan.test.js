/*
 * test/plan.test.js — pure parse/render/merge tests for src/plan.js.
 * No disk I/O, no LLM calls.
 */

"use strict";

const { describe, test } = require("node:test");
const assert = require("node:assert/strict");

const {
  mondayOf,
  splitSections,
  joinSections,
  emptyWeeklyText,
  mergeWeeklyText,
  weeklyView,
  parseObjectiveReply,
} = require("../src/plan");

describe("mondayOf", () => {
  test("snaps to Monday", () => {
    assert.equal(mondayOf("2026-06-29"), "2026-06-29"); // a Monday
    assert.equal(mondayOf("2026-07-01"), "2026-06-29"); // Wed → same Monday
    assert.equal(mondayOf("2026-07-05"), "2026-06-29"); // Sun → same Monday
    assert.equal(mondayOf("2026-07-06"), "2026-07-06"); // next Monday
  });
});

describe("split/join round-trip", () => {
  test("preserves title, preamble, and unknown sections", () => {
    const md = "# Week of 2026-06-29\n\nintro line\n\n## Objectives\n- [ ] ship X\n\n## Notes\nkeep me\n";
    const parsed = splitSections(md);
    assert.equal(parsed.title, "Week of 2026-06-29");
    const out = joinSections(parsed);
    assert.match(out, /## Notes\nkeep me/);
    assert.match(out, /- \[ \] ship X/);
  });
});

describe("mergeWeeklyText", () => {
  const week = "2026-06-29";

  test("scaffolds from empty and adds objectives", () => {
    const out = mergeWeeklyText("", { objectives: ["Ship onboarding", "Wire Slack"] }, week);
    const v = weeklyView(out);
    assert.deepEqual(v.objectives.map((o) => o.text), ["Ship onboarding", "Wire Slack"]);
    assert.ok(v.objectives.every((o) => !o.done));
  });

  test("dedups objectives by normalized text", () => {
    let md = mergeWeeklyText("", { objectives: ["Ship onboarding"] }, week);
    md = mergeWeeklyText(md, { objectives: ["ship  Onboarding!"] }, week);
    assert.equal(weeklyView(md).objectives.length, 1);
  });

  test("checks off resolved objectives", () => {
    let md = mergeWeeklyText("", { objectives: ["Ship onboarding"] }, week);
    md = mergeWeeklyText(md, { checkObjectives: ["Ship onboarding"] }, week);
    assert.equal(weeklyView(md).objectives[0].done, true);
  });

  test("appends dated progress", () => {
    const md = mergeWeeklyText("", { progress: ["wrote plan.js"], date: "2026-06-30" }, week);
    assert.match(weeklyView(md).progress[0], /2026-06-30: wrote plan\.js/);
  });

  test("blockers dedup and increment seen count", () => {
    let md = mergeWeeklyText("", { blockers: ["API rate limit"], date: "2026-06-29" }, week);
    md = mergeWeeklyText(md, { blockers: ["api rate-limit"], date: "2026-06-30" }, week);
    const b = weeklyView(md).blockers;
    assert.equal(b.length, 1);
    assert.equal(b[0].count, 2);
    assert.equal(b[0].since, "2026-06-29");
  });

  test("daily log replaces same-date line", () => {
    let md = mergeWeeklyText("", { dailySummary: { date: "2026-06-30", text: "first" } }, week);
    md = mergeWeeklyText(md, { dailySummary: { date: "2026-06-30", text: "second" } }, week);
    const daily = weeklyView(md).daily;
    assert.equal(daily.length, 1);
    assert.match(daily[0], /second → log\/2026-06-30\.md/);
  });

  test("preserves a hand-added unknown section across merges", () => {
    const seed = emptyWeeklyText(week) + "\n## Notes\nremember this\n";
    const md = mergeWeeklyText(seed, { progress: ["did a thing"], date: "2026-06-30" }, week);
    assert.match(md, /## Notes\nremember this/);
  });

  test("setObjectives replaces the whole list", () => {
    let md = mergeWeeklyText("", { objectives: ["old one", "old two"] }, week);
    md = mergeWeeklyText(md, { setObjectives: ["fresh A", "fresh B"] }, week);
    const v = weeklyView(md);
    assert.deepEqual(v.objectives.map((o) => o.text), ["fresh A", "fresh B"]);
  });
});

describe("parseObjectiveReply", () => {
  test("strips numbering/bullets and drops empties", () => {
    const items = parseObjectiveReply("1. ship onboarding\n- wire Slack\n\n• polish UI");
    assert.deepEqual(items, ["ship onboarding", "wire Slack", "polish UI"]);
  });
  test("single line with no breaks → one item", () => {
    assert.deepEqual(parseObjectiveReply("just focus on the demo"), ["just focus on the demo"]);
  });
});
