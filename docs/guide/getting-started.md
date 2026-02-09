# Agent Developer Guide

Connect your AI agent to ModelGuide via the Model Context Protocol (MCP). This guide walks through authentication, tool discovery, session management, and executing tools.

## Prerequisites

- A running ModelGuide instance (see [Quick Start](../../README.md#quick-start))
- An agent API key (`mgk_...`) — created by an admin via the dashboard or REST API

## Connecting via MCP

ModelGuide exposes an MCP endpoint using Streamable HTTP transport:

```
POST /mcp
Authorization: Bearer mgk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
Content-Type: application/json
```

The API key identifies your agent and determines which tools are available. Each request creates a fresh MCP server scoped to your agent's permissions.

### Using the MCP SDK

```typescript
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const transport = new StreamableHTTPClientTransport(
  new URL("http://localhost:3000/mcp"),
  {
    requestInit: {
      headers: {
        Authorization: "Bearer mgk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
      },
    },
  }
);

const client = new Client({ name: "my-agent", version: "1.0.0" });
await client.connect(transport);
```

## Tool Discovery

After connecting, call `tools/list` to see what tools your agent can use:

```typescript
const { tools } = await client.listTools();
```

This returns only tools assigned to your agent. Tools are namespaced by connector instance:

| Tool Name | Source |
|-----------|--------|
| `core_create_session` | Built-in platform tool |
| `core_end_session` | Built-in platform tool |
| `core_escalate_session` | Built-in platform tool |
| `core_rate_session` | Built-in platform tool |
| `pizzapalace_add_to_cart` | Medusa connector (instance: pizzapalace) |
| `pizzapalace_confirm_order` | Medusa connector (instance: pizzapalace) |

The `core_*` tools are always available. Connector tools depend on what an admin has assigned to your agent.

## Session Lifecycle

Every conversation should be wrapped in a session. Sessions track messages, tool calls, and feedback.

### 1. Create a Session

```typescript
const result = await client.callTool({
  name: "core_create_session",
  arguments: {
    channel_type: "voice",          // voice, web, api, slack, widget, sms, whatsapp
    user_identifier: "user_456",    // your identifier for the end user
    user_metadata: {                // optional
      name: "John Doe",
      phone: "+1234567890",
    },
  },
});
// result.content → [{ type: "text", text: '{"session_id": "uuid"}' }]
```

Save the `session_id` — you'll need it for every subsequent call.

### 2. Use Connector Tools

Pass the `session_id` with each tool call:

```typescript
const result = await client.callTool({
  name: "pizzapalace_add_to_cart",
  arguments: {
    session_id: "the-session-id",
    item: "pizza",
    size: "large",
    toppings: ["pepperoni"],
    quantity: 1,
  },
});
```

**Success response:**
```json
{
  "success": true,
  "data": {
    "cart_id": "cart_123",
    "item_id": "item_456",
    "subtotal": 18.99
  }
}
```

### 3. End the Session

When the conversation is complete, end the session with the full message history:

```typescript
await client.callTool({
  name: "core_end_session",
  arguments: {
    session_id: "the-session-id",
    messages: [
      {
        role: "assistant",
        content: "Hi, welcome to Pizza Palace! How can I help?",
        timestamp: "2024-01-15T10:00:00Z",
      },
      {
        role: "user",
        content: "I'd like a large pepperoni pizza",
        timestamp: "2024-01-15T10:00:15Z",
      },
      {
        role: "assistant",
        content: "I've added that to your cart.",
        timestamp: "2024-01-15T10:00:17Z",
        tool_calls: [
          {
            tool_name: "pizzapalace_add_to_cart",
            input: { item: "pizza", size: "large", toppings: ["pepperoni"], quantity: 1 },
            output: { cart_id: "cart_123", subtotal: 18.99 },
            status: "success",
          },
        ],
      },
    ],
  },
});
```

## Confirmation Flow

Some tools are flagged with `requires_confirmation` — these represent destructive or irreversible actions (placing an order, canceling a booking). When you call a confirmation-required tool, ModelGuide returns a confirmation prompt instead of executing immediately:

```json
{
  "success": false,
  "confirmation_required": true,
  "confirmation_id": "conf_xxxxx",
  "confirmation_message": "This action requires user confirmation",
  "action_summary": {
    "tool": "pizzapalace_confirm_order",
    "description": "Confirm order for $34.74",
    "parameters": { "draft_order_id": "draft_789", "total": 34.74 }
  },
  "expires_at": "2024-01-15T10:05:00Z"
}
```

Your agent should:

1. Present the `action_summary` to the user and ask for confirmation
2. If confirmed, call the same tool again with `_confirmation_id`:

```typescript
await client.callTool({
  name: "pizzapalace_confirm_order",
  arguments: {
    session_id: "the-session-id",
    draft_order_id: "draft_789",
    _confirmation_id: "conf_xxxxx",
  },
});
```

Confirmation tokens expire (see `expires_at`). If expired, the user must re-initiate the action.

## Escalation

When your agent can't resolve a request, escalate to human support:

```typescript
await client.callTool({
  name: "core_escalate_session",
  arguments: {
    session_id: "the-session-id",
  },
});
```

The session status changes to `escalated` and it surfaces in the dashboard for the support team.

## CSAT Rating

Record customer satisfaction at the end of a conversation:

```typescript
await client.callTool({
  name: "core_rate_session",
  arguments: {
    session_id: "the-session-id",
    rating: 2,  // 1 = negative, 2 = positive
  },
});
```

## Error Handling

Tool calls return structured errors:

```json
{
  "success": false,
  "error": {
    "code": "TOOL_NOT_ASSIGNED",
    "message": "Tool 'zendesk_create_ticket' is not assigned to this agent"
  }
}
```

**Common error codes:**

| Code | Meaning |
|------|---------|
| `AGENT_INACTIVE` | Agent has been deactivated by an admin |
| `AGENT_KEY_INVALID` | API key is wrong or revoked |
| `TOOL_NOT_ASSIGNED` | Tool exists but isn't assigned to your agent |
| `TOOL_DISABLED` | Tool is assigned but currently disabled |
| `SESSION_NOT_FOUND` | Invalid session ID |
| `SESSION_ENDED` | Session was already closed |
| `CONFIRMATION_REQUIRED` | Tool needs user confirmation (see above) |
| `CONFIRMATION_EXPIRED` | Confirmation token timed out |
| `CONFIRMATION_INVALID` | Wrong confirmation ID |
| `CONNECTOR_ERROR` | The external service (Medusa, Zendesk, etc.) returned an error |

## MCP Resources

Your agent can also read MCP resources for metadata:

| Resource URI | Description |
|-------------|-------------|
| `agent://config` | Your agent's configuration (name, status, tool count) |
| `tools://list` | Detailed list of available tools with schemas |
| `tools://{tool_name}` | Full schema for a specific tool |

## Full Example

Here's a minimal agent that creates a session, calls a tool, and ends the session:

```typescript
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

async function main() {
  // Connect
  const transport = new StreamableHTTPClientTransport(
    new URL("http://localhost:3000/mcp"),
    {
      requestInit: {
        headers: { Authorization: "Bearer mgk_your_key_here" },
      },
    }
  );
  const client = new Client({ name: "example-agent", version: "1.0.0" });
  await client.connect(transport);

  // Discover tools
  const { tools } = await client.listTools();
  console.log("Available tools:", tools.map((t) => t.name));

  // Start session
  const session = await client.callTool({
    name: "core_create_session",
    arguments: { channel_type: "api", user_identifier: "demo-user" },
  });
  const { session_id } = JSON.parse(session.content[0].text);

  // Call a tool
  const result = await client.callTool({
    name: "pizzapalace_add_to_cart",
    arguments: {
      session_id,
      item: "pizza",
      size: "large",
      toppings: ["pepperoni"],
      quantity: 1,
    },
  });
  console.log("Tool result:", result.content[0].text);

  // End session
  await client.callTool({
    name: "core_end_session",
    arguments: {
      session_id,
      messages: [
        {
          role: "user",
          content: "Add a large pepperoni pizza",
          timestamp: new Date().toISOString(),
        },
      ],
    },
  });

  console.log("Session ended.");
  await client.close();
}

main().catch(console.error);
```

## Next Steps

- [Admin Setup Guide](admin-setup.md) — Configure connectors, create agents, assign tools
- [API Specification](../api-spec.md) — Full REST API and MCP reference
- [Adding a Connector](../../README.md#adding-a-connector) — Build your own connector
