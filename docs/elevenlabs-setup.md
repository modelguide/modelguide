# ElevenLabs Integration Setup Guide

Step-by-step recipe for connecting an ElevenLabs Conversational AI agent to ModelGuide.

## Prerequisites

- ElevenLabs account with a Conversational AI agent created
- ModelGuide API running locally (`make api-dev` on port 3000)
- A tunnel tool ([ngrok](https://ngrok.com/) or [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/))

## 1. Expose your local API with a tunnel

ElevenLabs needs to reach your local API for MCP tool calls and webhooks.

```bash
# Option A
ngrok http 3000

# Option B
cloudflared tunnel --url http://localhost:3000
```

Copy the HTTPS URL (e.g. `https://abc123.ngrok-free.app`) and set it in `modelguide-api/.env`:

```
API_EXTERNAL_ADDRESS=https://abc123.ngrok-free.app
```

Restart the API server — this env var is read at startup.

> **Note:** Every time the tunnel URL changes, you must update `API_EXTERNAL_ADDRESS`, restart the API, and re-sync (step 5).

## 2. Create the agent in ModelGuide UI

1. Navigate to **Agents → Create Agent**
2. Set **Platform** to "ElevenLabs"
3. Paste the **ElevenLabs Agent ID** (from ElevenLabs dashboard → your agent → Agent ID)
4. Save

Note the generated API key (`mgk_...`) — you'll need it in later steps.

## 3. Configure the ElevenLabs API key

1. On the agent detail page, find the **Platform** card
2. Click **"Configure Key"**
3. Paste your ElevenLabs API key (from [elevenlabs.io](https://elevenlabs.io) → Profile + API key)
4. Save

## 4. Sync to ElevenLabs

Once both checkmarks show (Agent ID ✓, API Key ✓), click **"Sync to ElevenLabs"** and confirm in the dialog.

### What sync does

Sync configures the ElevenLabs agent with everything it needs to talk to ModelGuide:

| Resource | Details |
|----------|---------|
| **API key secret** | Stores the ModelGuide API key (`mgk_...`) on ElevenLabs for MCP authentication |
| **MCP server** | Streamable HTTP server at `{API_EXTERNAL_ADDRESS}/mcp/{agentId}` with auto-approve policy |
| **Post-call webhook** | Points to `{API_EXTERNAL_ADDRESS}/webhooks/elevenlabs/{agentId}/post-call` with HMAC authentication |
| **Agent assignment** | Attaches the MCP server and webhook to the ElevenLabs agent (preserving any other MCP servers) |
| **Local metadata** | Stores server ID, webhook ID, and HMAC secret for future re-syncs |

## 5. Add session binding to the ElevenLabs system prompt

In the ElevenLabs dashboard, add this line at the end of the agent's **system prompt**:

```
Your session_id is {{mg_session_id}}.
```

This binds the ElevenLabs dynamic variable `mg_session_id` to the `session_id` parameter that every MCP tool requires. **Without this line, the agent won't know which session ID to pass to tools.**

## 6. Configure dynamic variables in ElevenLabs

In the ElevenLabs agent settings → **Dynamic Variables**, set:

| Variable | Value |
|----------|-------|
| `mg_session_id` | Leave empty — populated at conversation start via client SDK |
| `mg_user_id` | Optional user identifier for session tracking |

> The ModelGuide API key is **not** passed as a dynamic variable — sync already stores it as an API key secret on ElevenLabs for MCP authentication (see step 4).

## 7. Test the integration

1. Start a conversation with the ElevenLabs agent
2. Verify the agent can discover and call ModelGuide tools
3. After the call ends, check that a session appears in ModelGuide (**Sessions** page)

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Tunnel URL changed | Re-sync — the old MCP/webhook URLs are stale |
| Tools not showing | Check `API_EXTERNAL_ADDRESS` is set and reachable; verify sync completed |
| Webhook not firing | Ensure post-call webhook is assigned in ElevenLabs agent settings |
| HMAC verification failed | Re-sync to regenerate the webhook secret |
| "session not found" errors | Ensure `mg_session_id` dynamic variable is set and the system prompt includes `{{mg_session_id}}` |
