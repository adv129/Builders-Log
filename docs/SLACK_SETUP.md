# Slack setup

Slack is optional. Turning it on adds two things to Builder Log:

1. **Reminder DMs** — the agent can DM you "time for your check-in" with a link to the web app.
2. **Instructor delivery** — after a check-in, you can send the drafted instructor note to your mentor as a DM.

The check-in itself still happens in the web app — Slack is not a question/answer surface. Setup takes ~5 minutes. Each person runs their **own** Slack app in their **own** workspace; nothing is shared.

It uses the Slack Web API methods `conversations.open` and `chat.postMessage`. No public URL, no always-on process — messages are sent on a trigger (a button in the web app, or a CLI run).

## ⚠️ One rule that matters: keep it an *internal* app

In May 2025 Slack throttled some API methods to **1 request/minute** for **publicly distributed** non-Marketplace apps. **Internal apps** (built and installed in your own workspace, distribution OFF) keep the normal **50+ requests/minute**.

So: **create your own app in your own workspace and never enable "Activate Public Distribution."**

## Steps

### 1. Create the app from the manifest
1. Go to <https://api.slack.com/apps> → **Create New App** → **From a manifest**.
2. Choose your workspace.
3. Paste the contents of [`slack-app-manifest.yaml`](../slack-app-manifest.yaml) and create.

This requests exactly the scopes needed: `chat:write`, `im:write`, `im:history`.

### 2. Install it and grab the bot token
1. On the app's **Install App** page, click **Install to Workspace** and approve.
2. Copy the **Bot User OAuth Token** (starts with `xoxb-`).

### 3. Confirm it's internal
On **Manage Distribution**, leave **Activate Public Distribution** OFF. Done — you're on the higher rate limit.

### 4. Add the token
The token is a secret, so it lives in your environment (`.env`), never in `config.json`. Two ways:

- **In the web app (recommended):** **Settings → Slack**, turn on "Enable Slack messaging", paste the token into **Bot token → Save token**. It's written to your local `.env` and applied immediately — no restart.
- **By hand:** add a line to `.env`:
  ```
  SLACK_BOT_TOKEN=xoxb-your-token
  ```
  then restart the server.

### 5. Find the Slack user IDs
You need the Slack user IDs for yourself (the builder) and your instructor.
- In Slack: click a person's name → **profile** → **⋮ More** → **Copy member ID** (looks like `U0123ABCD`).

### 6. Configure
In the web app **Settings → Slack**, set your IDs and the review gate, then **Check connection** to confirm the token works. (This writes the following to `config.json`:)
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
- `gateInstructorMessages: true` (recommended) means the note to your instructor is **drafted, not sent** — you review it, then click **Send to instructor** to post it. Set `false` to auto-send.

### 7. Use it
From the web app:
- **Send reminder** — DMs you a check-in reminder with a link to the app.
- **Send to instructor** — sends the drafted instructor note for the latest entry.

Or from the CLI (same engine):
```sh
node src/cli.js ask     # observe work delta, generate questions
node src/cli.js sync    # synthesize the entry + draft the instructor note
```

## Troubleshooting

| Error | Meaning / fix |
|---|---|
| `SLACK_BOT_TOKEN is not set` | Save the token in Settings → Slack, or add `SLACK_BOT_TOKEN=xoxb-...` to `.env` and restart. |
| `slack chat.postMessage: missing_scope` | Re-check the manifest scopes, then reinstall the app. |
| `slack ...: not_in_channel` | The bot must be in the conversation. For DMs this is automatic (we call `conversations.open` first). |
| `slack ...: ratelimited` / HTTP 429 | The connector retries with backoff. If it persists, your app is likely **distributed** — turn distribution OFF to restore the higher limit. |
| Check connection says "rejected" | The token is wrong or revoked. Re-copy the Bot User OAuth Token and Save again. |
