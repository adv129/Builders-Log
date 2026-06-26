/*
 * Builder Log Agent — Memory (structured history)
 *
 * Pure functions over state. This file ACCUMULATES structured memory as plain
 * data — commitments, blockers, file churn. It deliberately makes NO judgment
 * about what is "stalling" or significant: hardcoded thresholds don't generalize
 * across contexts, so significance is judged downstream by the LLM from this
 * history plus the deployment's context. `historyView` is the read-only
 * projection used both to prompt the model and to print factual status.
 */

function daysSince(dateStr, today) {
  if (!dateStr) return 0;
  const a = new Date(dateStr + "T00:00:00");
  const b = new Date(today + "T00:00:00");
  return Math.round((b - a) / 86400000);
}

function nextId(commitments) {
  let max = 0;
  for (const c of commitments) {
    const m = /^c(\d+)$/.exec(c.id || "");
    if (m) max = Math.max(max, +m[1]);
  }
  return "c" + (max + 1);
}

function norm(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
}

// Fold the LLM's extracted facts into state: resolve, carry, add, track blockers.
function applyExtraction(state, ex, date) {
  state.commitments = state.commitments || [];
  state.blockers = state.blockers || [];
  ex = ex || {};

  // Mark prior commitments resolved when today gives real evidence.
  for (const r of ex.resolved || []) {
    const c = state.commitments.find((c) => c.id === r.id && c.status !== "done");
    if (c) {
      c.status = "done";
      c.evidence = r.evidence || "done";
      c.resolvedOn = date;
    }
  }

  // Carry every still-open commitment one more cycle.
  for (const c of state.commitments) {
    if (c.status === "open") c.carried = (c.carried || 0) + 1;
  }

  // Add new commitments, deduped against open ones by normalized text.
  for (const n of ex.newCommitments || []) {
    if (!n || !n.text) continue;
    const dup = state.commitments.find((c) => c.status === "open" && norm(c.text) === norm(n.text));
    if (dup) continue;
    state.commitments.push({
      id: nextId(state.commitments),
      text: n.text,
      openedOn: date,
      due: n.due || null,
      status: "open",
      evidence: null,
      carried: 0,
      resolvedOn: null,
    });
  }

  // Track blocker recurrence by normalized text.
  for (const b of ex.blockers || []) {
    if (!b) continue;
    const hit = state.blockers.find((x) => norm(x.text) === norm(b));
    if (hit) {
      hit.count = (hit.count || 1) + 1;
      hit.lastSeen = date;
    } else {
      state.blockers.push({ text: String(b), firstSeen: date, lastSeen: date, count: 1 });
    }
  }
  return state;
}

// Count how often each file has appeared in a delta (thrash signal).
function bumpChurn(state, changedFiles) {
  state.fileChurn = state.fileChurn || {};
  for (const f of changedFiles || []) state.fileChurn[f] = (state.fileChurn[f] || 0) + 1;
  return state;
}

// Read-only projection of state into factual history — no verdict, no thresholds.
// Consumed by the sync prompt (LLM judges significance) and by `status` (prints facts).
function historyView(state, today) {
  const openCommitments = (state.commitments || [])
    .filter((c) => c.status === "open")
    .map((c) => ({
      id: c.id,
      text: c.text,
      openedOn: c.openedOn,
      daysOpen: daysSince(c.openedOn, today),
      carried: c.carried || 0,
      due: c.due || null,
      hasEvidence: !!c.evidence,
    }));

  const blockers = (state.blockers || []).map((b) => ({
    text: b.text,
    count: b.count || 1,
    firstSeen: b.firstSeen,
    lastSeen: b.lastSeen,
  }));

  const churn = Object.entries(state.fileChurn || {}).map(([file, changes]) => ({ file, changes }));

  return { openCommitments, blockers, churn };
}

module.exports = { daysSince, nextId, norm, applyExtraction, bumpChurn, historyView };
