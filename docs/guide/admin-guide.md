# Admin Setup Guide

Configure ModelGuide to connect your AI agents with your business systems. This guide walks through the dashboard workflow: creating secrets, configuring connectors, setting up agents, and verifying everything works end-to-end.

## Prerequisites

- ModelGuide running locally (see [Quick Start](../../README.md#quick-start))
- Admin account credentials

## Overview

The setup flow follows this order:

```
1. Create secrets (API tokens, credentials)
       ↓
2. Configure a connector (link to your business system)
       ↓
3. Create an agent (get an API key)
       ↓
4. Assign tools to the agent
       ↓
5. Verify with a test call
```

## 1. Create Secrets

Secrets store encrypted credentials that connectors use to authenticate with external services. Navigate to **Secrets** in the sidebar.

**To create a secret:**

1. Click **Create Secret**
2. Enter a descriptive name (e.g., "Medusa Production API Token")
3. Paste the credential value
4. Click **Create**

The value is encrypted with AES-256-GCM before storage and can never be retrieved — only replaced. Create one secret per credential you need.

**Via REST API:**

```bash
curl -X POST http://localhost:3000/api/secrets \
  -H "Authorization: Bearer <your-jwt>" \
  -H "Content-Type: application/json" \
  -d '{"name": "Medusa API Token", "value": "sk_live_xxxxx"}'
```

Save the returned `id` — you'll reference it when configuring connectors.

## 2. Configure a Connector

Connectors are pre-registered from the codebase catalog. Navigate to **Connectors** in the sidebar to see available connector types.

**To configure a connector instance:**

1. Click **Configure** on the connector card (e.g., Medusa)
2. Fill in the configuration fields:
   - **String fields** — Enter values directly (e.g., API base URL)
   - **Secret fields** — Select from your created secrets (dropdown)
3. Click **Save Configuration**
4. Click **Test Connection** to verify the credentials work

A connector shows as "Configured" when all required fields have values. The health check makes a real API call to the external service.

**Via REST API:**

```bash
# Configure connector (secret fields take the secret UUID)
curl -X PATCH http://localhost:3000/api/connectors/<connector-id> \
  -H "Authorization: Bearer <your-jwt>" \
  -H "Content-Type: application/json" \
  -d '{
    "config": {
      "base_url": "https://api.yourstore.com",
      "api_token": "<secret-uuid>"
    }
  }'

# Test connection
curl -X POST http://localhost:3000/api/connectors/<connector-id>/health-check \
  -H "Authorization: Bearer <your-jwt>"
```

## 3. Create an Agent

Agents represent external AI systems (voice bots, chat agents) that connect via MCP. Navigate to **Agents** in the sidebar.

**To create an agent:**

1. Click **Create Agent**
2. Enter a name and description
3. Select the agent type (currently: voice)
4. Click **Create**

On creation, you'll see the API key **exactly once**:

```
mgk_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6
```

**Copy and save this key securely.** It cannot be retrieved again. If lost, you'll need to regenerate it (which invalidates the previous key immediately).

The agent is created in an **inactive** state. You'll activate it after assigning tools.

**Via REST API:**

```bash
curl -X POST http://localhost:3000/api/agents \
  -H "Authorization: Bearer <your-jwt>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "GlowBox Voice Concierge",
    "description": "Voice concierge for product recs, orders, and returns",
    "agent_type": "voice"
  }'
# Response includes id and api_key — save both.
```

## 4. Assign Tools to the Agent

From the agent detail page, assign connectors and select which tools the agent can use.

**To assign tools:**

1. Open the agent detail page
2. Click **Add Connector**
3. Select a configured connector from the dropdown
4. All tools are enabled by default — toggle any you want to disable
5. Set the **Requires Confirmation** flag on destructive tools (e.g., `confirm_order`, `cancel_order`)
6. Click **Save**

Tool names are namespaced by the connector instance slug. If your Medusa connector instance is slugged `glowbox_store`, tools appear as `glowbox_store_add_to_cart`, `glowbox_store_confirm_order`, etc.

**Via REST API:**

```bash
curl -X POST http://localhost:3000/api/agents/<agent-id>/connectors \
  -H "Authorization: Bearer <your-jwt>" \
  -H "Content-Type: application/json" \
  -d '{
    "connector_id": "<connector-uuid>",
    "tools": [
      {"name": "add_to_cart", "is_enabled": true, "requires_confirmation": false},
      {"name": "get_cart", "is_enabled": true, "requires_confirmation": false},
      {"name": "confirm_order", "is_enabled": true, "requires_confirmation": true}
    ]
  }'
```

## 5. Activate the Agent

Once tools are assigned, activate the agent:

1. On the agent detail page, click **Activate**
2. The status badge changes to active

Inactive agents cannot authenticate via MCP — their API key is rejected.

**Via REST API:**

```bash
curl -X POST http://localhost:3000/api/agents/<agent-id>/activate \
  -H "Authorization: Bearer <your-jwt>"
```

## 6. Verify End-to-End

Test that your agent can connect and use tools. See the [MCP Integration Guide](mcp-integration.md) for full MCP integration details, but here's a quick verification:

```bash
# List available tools via MCP
curl -X POST http://localhost:3000/mcp/<agent-id> \
  -H "Authorization: Bearer mgk_your_agent_key" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc": "2.0", "method": "tools/list", "id": 1}'
```

Use the same `<agent-id>` and `mgk_...` pair returned for that agent. You should see the core tools plus all connector tools assigned to it.

## Managing Existing Resources

### Regenerate an API Key

If an agent's key is compromised:

1. Open the agent detail page
2. Click **Regenerate Key**
3. Confirm — the old key is invalidated immediately
4. Save the new key

### Update Connector Credentials

When credentials rotate:

1. Go to **Secrets** and update the secret value (or create a new secret)
2. If you created a new secret, update the connector configuration to reference it
3. Run **Test Connection** to verify

### Monitor Sessions

Once agents are running, the **Sessions** page shows real-time activity:

- Filter by agent, status, channel, date range, and feedback
- Click any session to see the full transcript with tool call traces
- Add internal evaluations with tags like `good_resolution`, `wrong_tool`, `hallucination`

## Next Steps

- [MCP Integration Guide](mcp-integration.md) — Full MCP integration walkthrough
- [Adding a Connector](adding-a-connector.md) — Build a custom connector
- [Local API docs](http://localhost:3000/docs) — REST endpoints and schemas
