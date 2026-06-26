# Slack setup

This walks you through turning on Slack mode, where the agent DMs you (and your instructor) the questions and reads your replies back on the next run. It takes ~5 minutes.

## How it works (and why it's simple)

The agent **polls** for replies — on each run it asks Slack "what messages arrived in this DM since last time?" That means:

- **No public URL, no server, no always-on process.** It fits the run-on-a-trigger model (manual or cron).
- It uses the Slack Web API methods `conversations.open`, `chat.postMessage`, and `conversations.history`.

## ⚠️ One rule that matters: keep it an *internal* app

In May 2025 Slack throttled `conversations.history` to **1 request/minute** for **publicly distributed** non-Marketplace apps — which would break reply polling. **Internal apps** (built and installed in your own workspace, distribution OFF) keep the normal **50+ requests/minute**.

So: **create your own app in your own workspace and never enable "Activate Public Distribution."** That keeps you exempt. (Each person running Builders Log makes their own app — we don't ship one shared app.)

## Steps

### 1. Create the app from the manifest
1. Go to <https://api.slack.com/apps> → **Create New App** → **From a manifest**.
2. Choose your workspace.
3. Paste the contents of [`slack-app-manifest.yaml`](../slack-app-manifest.yaml) and create.

This requests exactly the scopes needed: `chat:write`, `im:write`, `im:history`.

### 2. Install it and grab the bot token
1. In the app's **Install App** page, click **Install to Workspace** and approve.
2. Copy the **Bot User OAuth Token** (starts with `xoxb-`).
3. Put it in your environment (not in config.json):
   ```sh
   export SLACK_BOT_TOKEN="xoxb-your-token"
   ```

### 3. Confirm it's internal
On **Manage Distribution**, leave **Activate Public Distribution** OFF. Done — you're on the higher rate limit.

### 4. Find the Slack user IDs
You need the Slack user IDs for yourself (the builder) and your instructor.
- In Slack: click a person's name → **profile** → **⋮ More** → **Copy member ID** (looks like `U0123ABCD`).

### 5. Configure
In `config.json`:
```json
{
  "chatSurface": "slack",
  "slack": {
    "studentUserId": "U_your_id",
    "instructorUserId": "U_instructor_id",
    "gateInstructorMessages": true
  }
}
```
- `gateInstructorMessages: true` (recommended) means the note to your instructor is **drafted, not sent** — you review, then run `node loop.js send-instructor` to post it. Set `false` to auto-send.

### 6. Run it
```sh
node loop.js ask     # DMs you the questions
# ...reply in Slack...
node loop.js sync    # reads your replies, writes the entry, drafts the instructor note
node loop.js send-instructor   # (if gated) posts the reviewed note to your instructor
```

## Troubleshooting

| Error | Meaning / fix |
|---|---|
| `SLACK_BOT_TOKEN not set` | `export SLACK_BOT_TOKEN=xoxb-...` in the shell you run from. |
| `slack chat.postMessage: missing_scope` | Re-check the manifest scopes, then reinstall the app. |
| `slack ...: not_in_channel` | The bot must be in the conversation. For DMs this is automatic (we call `conversations.open` first); for a channel, invite the bot. |
| `slack ...: ratelimited` / HTTP 429 | The connector retries with backoff. If it persists, your app is likely **distributed** — turn distribution OFF to restore the higher limit. |
| Replies not picked up | Make sure you replied in the **DM from the bot** (not another channel), then run `sync` again. |

## Want a real-time bot instead?

This setup is for scheduled check-ins. If you later want the agent to respond the instant you message it, that's a different mode (Socket Mode + a small always-on listener). See [ARCHITECTURE.md](ARCHITECTURE.md) → "A new chat surface."
