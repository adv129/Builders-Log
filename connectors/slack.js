/*
 * Builder Log Agent — Slack connector.
 *
 * Trigger-based, NOT a daemon. The loop calls these on a trigger to send the
 * student questions / the instructor triage, and to read replies back as a
 * delta (conversations.history since a stored timestamp) — the Slack analogue
 * of the file snapshot. Bot token from env SLACK_BOT_TOKEN (never config).
 * Base URL overridable via SLACK_API_BASE so tests can use a local fake server.
 */

const BASE = process.env.SLACK_API_BASE || "https://slack.com/api";

function token() {
  const t = process.env.SLACK_BOT_TOKEN;
  if (!t) throw new Error("SLACK_BOT_TOKEN not set");
  return t;
}

// Single request path with Retry-After backoff on HTTP 429. Internal apps keep
// Slack's normal limits, but conversations.history is strict (1/min) for
// distributed apps — backoff keeps us correct either way.
async function request(method, url, options, attempts = 4) {
  for (let i = 0; ; i++) {
    const res = await fetch(url, options);
    if (res.status === 429 && i < attempts) {
      const retryAfter = parseInt(res.headers.get("retry-after") || "1", 10) || 1;
      await new Promise((r) => setTimeout(r, retryAfter * 1000));
      continue;
    }
    const data = await res.json();
    if (!data.ok) throw new Error(`slack ${method}: ${data.error || res.status}`);
    return data;
  }
}

function post(method, body) {
  return request(method, `${BASE}/${method}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
  });
}

function get(method, params) {
  const qs = new URLSearchParams(params).toString();
  return request(method, `${BASE}/${method}?${qs}`, { headers: { Authorization: `Bearer ${token()}` } });
}

let _botId = null;
async function botUserId() {
  if (_botId) return _botId;
  const data = await post("auth.test", {});
  _botId = data.user_id;
  return _botId;
}

// Open (or fetch) the DM channel with a user.
async function openDm(userId) {
  const data = await post("conversations.open", { users: userId });
  return data.channel.id;
}

// Post a message; returns its ts.
async function postMessage(channel, text) {
  const data = await post("chat.postMessage", { channel, text });
  return data.ts;
}

// Read messages in a channel strictly after oldestTs, excluding the bot's own.
// Paginates, dedupes by ts, returns oldest-first [{ ts, text, user }].
async function historySince(channel, oldestTs) {
  const botId = await botUserId();
  const seen = new Set();
  const all = [];
  let cursor;
  do {
    const params = { channel, limit: "200" };
    if (oldestTs && oldestTs !== "0") params.oldest = oldestTs;
    if (cursor) params.cursor = cursor;
    const data = await get("conversations.history", params);
    for (const m of data.messages || []) {
      if (seen.has(m.ts)) continue;
      seen.add(m.ts);
      all.push(m);
    }
    cursor = data.has_more ? data.response_metadata && data.response_metadata.next_cursor : null;
  } while (cursor);

  return all
    .filter((m) => m.user && m.user !== botId && m.subtype !== "bot_message")
    .map((m) => ({ ts: m.ts, text: m.text || "", user: m.user }))
    .sort((a, b) => Number(a.ts) - Number(b.ts));
}

// Convenience: DM a user. Returns { channel, ts }.
async function sendToUser(userId, text) {
  const channel = await openDm(userId);
  const ts = await postMessage(channel, text);
  return { channel, ts };
}

module.exports = { openDm, postMessage, historySince, sendToUser, botUserId };
