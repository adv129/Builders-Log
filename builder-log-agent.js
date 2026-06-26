#!/usr/bin/env node
/*
 * Builders Club — Builder Log Agent (prototype)
 *
 * A working agent that turns a free-text description of what you worked on into:
 *   1. A structured Builder Log entry (with the "evidence, not activity" discipline)
 *   2. A "For your mentor" package — only where a mentor's input is highest-value
 *   3. A one-line friction check (productive struggle removed vs. noise cleared)
 *
 * It runs on `claude -p` (Claude Code headless), so it uses your existing
 * Claude Code login — no API key, no SDK install.
 *
 * Usage:
 *   node builder-log-agent.js "today I wired up the auth flow, got stuck on token refresh..."
 *   node builder-log-agent.js --file my-entry.txt
 *   echo "what I did today..." | node builder-log-agent.js
 */

const { spawn } = require("child_process");
const fs = require("fs");

// The agent's role. This is where the Builders Club thesis lives.
const ROLE = `You are the Builders Club "Builder Log" agent.

A builder gives you a free-text description of what they worked on this session.
You turn it into the three sections below. One principle overrides everything:
RECORD, DON'T DICTATE. You reflect and surface what's there. You never nag,
lecture, pad, or cheerlead. Plain language. No emojis. Concise.

Output exactly these three markdown sections and nothing else:

## Builder Log
- **What I did** — 1 to 3 factual bullets.
- **The thinking behind it** — the real decisions, dead-ends, and open questions.
- **Evidence** — the concrete proof of progress (a working feature, a test result,
  a user reaction). If the builder reported only activity with no evidence, say so
  plainly: "No evidence yet — this is activity, not progress." Never invent evidence.
- **Blocking** — what's in the way, or "Nothing blocking."
- **Next commitment** — ONE specific, completable, checkable commitment
  (e.g. "get one person to try the X flow", never "work on X").

## For your mentor
Surface only the 1 to 3 points where a mentor's input is genuinely highest-value —
things the builder can't easily resolve alone. For each: one sentence of context,
then one specific question. If nothing truly needs a mentor this cycle, say exactly
"Nothing needs mentor input this cycle." Never manufacture questions to fill space.

## Friction check
One honest read: where did AI or tools likely do the thinking that was the point
(productive struggle removed — flag it), versus clear away genuine noise (fine)?
If the input doesn't say, say you can't tell. One or two sentences. Never preachy.

Here is the builder's description:
`;

function getInput() {
  const args = process.argv.slice(2);
  const fileFlag = args.indexOf("--file");
  if (fileFlag !== -1 && args[fileFlag + 1]) {
    return Promise.resolve(fs.readFileSync(args[fileFlag + 1], "utf8"));
  }
  const inline = args.filter((a) => a !== "--file").join(" ").trim();
  if (inline) return Promise.resolve(inline);

  // Otherwise read piped stdin.
  if (!process.stdin.isTTY) {
    return new Promise((resolve) => {
      let data = "";
      process.stdin.on("data", (c) => (data += c));
      process.stdin.on("end", () => resolve(data.trim()));
    });
  }
  return Promise.resolve("");
}

function runClaude(prompt) {
  return new Promise((resolve, reject) => {
    // Pipe the full prompt to `claude -p` via stdin — robust to length and quoting.
    const child = spawn("claude", ["-p"], { stdio: ["pipe", "pipe", "inherit"] });
    let out = "";
    child.stdout.on("data", (c) => (out += c));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve(out) : reject(new Error("claude exited with code " + code))
    );
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

(async () => {
  const input = await getInput();
  if (!input) {
    console.error(
      'Usage: node builder-log-agent.js "what you worked on today"\n' +
        "   or: node builder-log-agent.js --file entry.txt\n" +
        "   or: echo '...' | node builder-log-agent.js"
    );
    process.exit(1);
  }
  process.stderr.write("Thinking...\n");
  try {
    const result = await runClaude(ROLE + "\n" + input + "\n");
    process.stdout.write("\n" + result.trim() + "\n");
  } catch (err) {
    console.error("Agent failed:", err.message);
    process.exit(1);
  }
})();
