# Mastra WISMO Email Agent

Email agent for handling WISMO (Where Is My Order) inquiries, built with [Mastra.ai](https://mastra.ai) + ModelGuide MCP.

## How it works

```
Resend inbound email webhook
  → Hono server (POST /webhook)
  → Inbox filter (skip if not addressed to INBOX_EMAIL)
  → Strip quoted reply text
  → POST /api/sessions          (pre-create session — required by MCP tools)
  → POST /api/sessions/:id/messages  (store inbound email immediately)
  → wismoAgent.generate() with per-request MCPClient toolsets
      → modelguide.{ORDER_LOOKUP_TOOL}   (Medusa order lookup)
      → modelguide.{ZENDESK_TOOL}        (Zendesk ticket creation)
      ↳ onStepFinish: POST /api/sessions/:id/messages per step (real-time)
  → Send reply via Resend (threaded, from: INBOX_EMAIL)
  → PATCH /api/sessions/:id     (set final status: completed / abandoned)
```

Each agent step is stored immediately as it completes — if the process crashes mid-run, all messages up to that point are preserved in ModelGuide.

## Prerequisites

- [Bun](https://bun.sh) v1.x
- A running [ModelGuide API](../../modelguide-api/) instance
- A Resend account with inbound email domain configured
- An active ModelGuide agent with order lookup + Zendesk tools configured

## Local setup

```bash
cd examples/agents/mastra-wismo-email-agent
bun install
cp .env.example .env
# Fill in .env values
bun run dev
```

Verify the server is up:
```bash
curl http://localhost:3000/health
# {"status":"ok","timestamp":"..."}
```

Test the webhook locally (replace `to` with your `INBOX_EMAIL`):
```bash
curl -X POST http://localhost:3000/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "type": "email.received",
    "created_at": "2026-01-01T00:00:00Z",
    "data": {
      "email_id": "test-001",
      "created_at": "2026-01-01T00:00:00Z",
      "from": "customer@test.com",
      "to": ["support@yourdomain.com"],
      "subject": "Where is my order #1001?",
      "message_id": "<msg1@mail.test>"
    }
  }'
```

Emails addressed to any other recipient return `{ "skipped": true }` immediately with no downstream calls.

## Environment variables

| Variable | Description |
|---|---|
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `RESEND_API_KEY` | Resend API key |
| `INBOX_EMAIL` | The email address this agent handles — emails addressed elsewhere are skipped. Also used as the reply-from address. |
| `MCP_SERVER_URL` | Full MCP endpoint: `https://<host>/mcp/<agentId>` |
| `MCP_API_KEY` | Agent API key (`mgk_...`) — used for MCP calls and session management |
| `ORDER_LOOKUP_TOOL` | Tool name, e.g. `glowbox_store_look_up_order` |
| `ZENDESK_TOOL` | Tool name, e.g. `glowbox_zendesk_create_ticket` |
| `PORT` | Server port (default: `3000`) |
| `LOG_LEVEL` | `trace`/`debug`/`info`/`warn`/`error`/`fatal` (default: `info`) |
| `AGENT_MODEL` | Main agent model (default: `anthropic/claude-sonnet-4-6-20250514`) |
| `PROCESSOR_MODEL` | Structured output processor model (default: `anthropic/claude-haiku-4-5-20251001`) |
| `AGENT_MODEL_INPUT_COST` | USD per 1M input tokens for agent model (default: `3`) |
| `AGENT_MODEL_OUTPUT_COST` | USD per 1M output tokens for agent model (default: `15`) |
| `PROCESSOR_MODEL_INPUT_COST` | USD per 1M input tokens for processor model (default: `1`) |
| `PROCESSOR_MODEL_OUTPUT_COST` | USD per 1M output tokens for processor model (default: `5`) |
| `AGENT_INSTRUCTIONS` | Full system prompt override. Must include `{{sessionId}}` and `{{senderEmail}}` placeholders. |

### Cost tracking

The agent reports token usage and estimated USD cost to ModelGuide when closing a session. This data appears in the sessions list ("Cost" column) and session detail view.

**How it works:** The Anthropic API returns `usage` (input/output tokens) on every response. Mastra exposes the main agent model's usage via `result.usage`. Cost is computed as `(tokens / 1M) × price_per_1M` using the pricing env vars above.

**Processor model caveat:** Mastra uses a second model call internally to extract structured output from the agent's response (the `structuredOutput` option). Currently, Mastra does not expose the processor model's token usage separately — only the main agent model's usage is available in `result.usage`. The processor call is small (it just parses the agent's text into JSON), so its tokens are estimated as ~10% of agent output tokens. When Mastra adds per-model usage tracking, this estimate can be replaced with real data.

## Deploying to Railway

### Prerequisites
- Railway CLI: `npm install -g @railway/cli`
- A running ModelGuide API instance on Railway
- Resend account with inbound email domain configured

### Steps

1. Install CLI and login:
   ```bash
   railway login
   ```

2. From this directory, create and link project:
   ```bash
   railway init
   railway link
   ```

3. Set environment variables:
   ```bash
   railway variables set \
     ANTHROPIC_API_KEY=sk-ant-... \
     RESEND_API_KEY=re_... \
     INBOX_EMAIL=support@yourdomain.com \
     MCP_SERVER_URL=https://your-api.up.railway.app/mcp/agt_xxx \
     MCP_API_KEY=mgk_... \
     ORDER_LOOKUP_TOOL=your_store_look_up_order \
     ZENDESK_TOOL=your_zendesk_create_ticket \
     LOG_LEVEL=info
   ```

4. Deploy:
   ```bash
   railway up
   ```

5. Get your domain:
   ```bash
   railway domain
   ```

6. Configure Resend inbound webhook:
   - URL: `https://<your-domain>/webhook`
   - Events: `email.received`
