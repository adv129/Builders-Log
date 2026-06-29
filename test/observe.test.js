/*
 * test/observe.test.js — Snapshot and diff tests for src/observe.js.
 *
 * Tests diff() with hand-built snapshots and snapshot() with real temp dirs.
 * Zero LLM calls.
 */

"use strict";

const { describe, test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");

const { snapshot, diff, makeKey, parseKey } = require("../src/observe");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "bl-observe-test-"));
}

function rmTmp(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // Non-fatal — temp cleanup
  }
}

// ---------------------------------------------------------------------------
// diff() — pure logic, no disk I/O
// ---------------------------------------------------------------------------

describe("diff — added files", () => {
  test("correctly reports newly added file", () => {
    const prev = {};
    const curr = { "file.txt": 1000 };
    const d = diff(prev, curr);
    assert.deepEqual(d.added, ["file.txt"]);
    assert.deepEqual(d.modified, []);
    assert.deepEqual(d.deleted, []);
  });

  test("multiple files added", () => {
    const d = diff({}, { "a.txt": 1, "b.txt": 2 });
    assert.deepEqual(d.added.sort(), ["a.txt", "b.txt"]);
  });
});

describe("diff — modified files", () => {
  test("detects changed mtime as modified", () => {
    const prev = { "file.txt": 1000 };
    const curr = { "file.txt": 2000 };
    const d = diff(prev, curr);
    assert.deepEqual(d.added, []);
    assert.deepEqual(d.modified, ["file.txt"]);
    assert.deepEqual(d.deleted, []);
  });

  test("unchanged mtime is not reported", () => {
    const prev = { "file.txt": 1000 };
    const curr = { "file.txt": 1000 };
    const d = diff(prev, curr);
    assert.deepEqual(d.added, []);
    assert.deepEqual(d.modified, []);
    assert.deepEqual(d.deleted, []);
  });
});

describe("diff — deleted files", () => {
  test("correctly reports deleted file", () => {
    const prev = { "file.txt": 1000 };
    const curr = {};
    const d = diff(prev, curr);
    assert.deepEqual(d.added, []);
    assert.deepEqual(d.modified, []);
    assert.deepEqual(d.deleted, ["file.txt"]);
  });

  test("multiple files deleted", () => {
    const d = diff({ "a.txt": 1, "b.txt": 2 }, {});
    assert.deepEqual(d.deleted.sort(), ["a.txt", "b.txt"]);
  });
});

describe("diff — simultaneous changes", () => {
  test("handles all three change types at once", () => {
    const prev = { "a.txt": 1, "b.txt": 2 };
    const curr = { "a.txt": 99, "c.txt": 3 };
    const d = diff(prev, curr);
    assert.deepEqual(d.added, ["c.txt"]);
    assert.deepEqual(d.modified, ["a.txt"]);
    assert.deepEqual(d.deleted, ["b.txt"]);
  });
});

describe("diff — isFirstRun flag", () => {
  test("isFirstRun is true when prev is empty object", () => {
    const d = diff({}, { "a.txt": 1 });
    assert.equal(d.isFirstRun, true);
  });

  test("isFirstRun is true when prev is null/undefined", () => {
    const d = diff(null, { "a.txt": 1 });
    assert.equal(d.isFirstRun, true);
    const d2 = diff(undefined, { "a.txt": 1 });
    assert.equal(d2.isFirstRun, true);
  });

  test("isFirstRun is false when prev has entries", () => {
    const d = diff({ "a.txt": 1 }, { "a.txt": 2 });
    assert.equal(d.isFirstRun, false);
  });
});

describe("diff — sorted output", () => {
  test("added, modified, deleted arrays are sorted", () => {
    const prev = { "z.txt": 1, "a.txt": 2 };
    const curr = { "z.txt": 99, "b.txt": 3 };
    const d = diff(prev, curr);
    assert.deepEqual(d.modified, ["z.txt"]);
    assert.deepEqual(d.added, ["b.txt"]);
    assert.deepEqual(d.deleted, ["a.txt"]);
  });
});

// ---------------------------------------------------------------------------
// snapshot() — uses real temp dir
// ---------------------------------------------------------------------------

describe("snapshot — basic file detection", () => {
  test("detects files in root of temp dir", () => {
    const tmpDir = makeTmpDir();
    try {
      fs.writeFileSync(path.join(tmpDir, "index.js"), "// code");
      const snap = snapshot(tmpDir);
      assert.ok("index.js" in snap, "should include index.js");
      assert.equal(typeof snap["index.js"], "number", "mtime should be a number");
      assert.ok(snap["index.js"] > 0, "mtime should be positive");
    } finally {
      rmTmp(tmpDir);
    }
  });

  test("detects files in subdirectories", () => {
    const tmpDir = makeTmpDir();
    try {
      fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "src", "main.js"), "// main");
      const snap = snapshot(tmpDir);
      // Key is relative path
      const relKey = Object.keys(snap).find((k) => k.includes("main.js"));
      assert.ok(relKey, "should find main.js in subdirectory");
    } finally {
      rmTmp(tmpDir);
    }
  });
});

describe("snapshot — ignore rules", () => {
  test("ignores node_modules", () => {
    const tmpDir = makeTmpDir();
    try {
      fs.writeFileSync(path.join(tmpDir, "index.js"), "// code");
      fs.mkdirSync(path.join(tmpDir, "node_modules"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "node_modules", "dep.js"), "dep");
      const snap = snapshot(tmpDir);
      assert.ok(
        !Object.keys(snap).some((k) => k.startsWith("node_modules")),
        "no node_modules files"
      );
    } finally {
      rmTmp(tmpDir);
    }
  });

  test("ignores .git directory", () => {
    const tmpDir = makeTmpDir();
    try {
      fs.writeFileSync(path.join(tmpDir, "code.js"), "code");
      fs.mkdirSync(path.join(tmpDir, ".git"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, ".git", "config"), "git config");
      const snap = snapshot(tmpDir);
      assert.ok(
        !Object.keys(snap).some((k) => k.startsWith(".git")),
        "no .git files"
      );
    } finally {
      rmTmp(tmpDir);
    }
  });

  test("ignores dotfiles and dot-directories", () => {
    const tmpDir = makeTmpDir();
    try {
      fs.writeFileSync(path.join(tmpDir, "visible.js"), "code");
      fs.writeFileSync(path.join(tmpDir, ".env"), "secret=1");
      fs.writeFileSync(path.join(tmpDir, ".DS_Store"), "mac junk");
      const snap = snapshot(tmpDir);
      assert.ok("visible.js" in snap, "visible.js should be included");
      assert.ok(
        !Object.keys(snap).some((k) => k.startsWith(".")),
        "no dotfiles"
      );
    } finally {
      rmTmp(tmpDir);
    }
  });

  test("ignores .DS_Store in subdirectories", () => {
    const tmpDir = makeTmpDir();
    try {
      fs.mkdirSync(path.join(tmpDir, "sub"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "sub", ".DS_Store"), "mac junk");
      fs.writeFileSync(path.join(tmpDir, "sub", "real.txt"), "content");
      const snap = snapshot(tmpDir);
      assert.ok(
        !Object.keys(snap).some((k) => k.includes(".DS_Store")),
        "no .DS_Store anywhere"
      );
    } finally {
      rmTmp(tmpDir);
    }
  });
});

describe("snapshot — multi-root registry", () => {
  test("namespaces keys by root id and keeps roots separate", () => {
    const a = makeTmpDir();
    const b = makeTmpDir();
    try {
      // Same relative filename in both roots — must NOT collide.
      fs.writeFileSync(path.join(a, "README.md"), "a");
      fs.writeFileSync(path.join(b, "README.md"), "b");
      const snap = snapshot([{ id: "r1", path: a }, { id: "r2", path: b }]);
      assert.ok("r1/README.md" in snap, "root a namespaced");
      assert.ok("r2/README.md" in snap, "root b namespaced");
      assert.equal(Object.keys(snap).length, 2, "both tracked, no collision");
    } finally {
      rmTmp(a);
      rmTmp(b);
    }
  });

  test("string root keeps legacy bare keys (back-compat)", () => {
    const a = makeTmpDir();
    try {
      fs.writeFileSync(path.join(a, "x.js"), "x");
      const snap = snapshot(a);
      assert.ok("x.js" in snap, "bare key, no namespace");
    } finally {
      rmTmp(a);
    }
  });

  test("parseKey/makeKey round-trip with nested paths", () => {
    assert.deepEqual(parseKey(makeKey("r1", "src/a/b.js")), { rootId: "r1", rel: "src/a/b.js" });
    assert.deepEqual(parseKey("bare.js"), { rootId: null, rel: "bare.js" });
  });
});

describe("snapshot — empty and nonexistent dirs", () => {
  test("returns empty object for empty directory", () => {
    const tmpDir = makeTmpDir();
    try {
      const snap = snapshot(tmpDir);
      assert.deepEqual(snap, {});
    } finally {
      rmTmp(tmpDir);
    }
  });

  test("returns empty object for nonexistent directory (does not throw)", () => {
    const nonexistent = path.join(os.tmpdir(), "bl-nonexistent-9999999");
    const snap = snapshot(nonexistent);
    assert.deepEqual(snap, {});
  });
});
