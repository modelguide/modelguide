# ModelGuide API & MCP Specification

## Overview

This specification defines the REST API (Hono) and MCP (@modelcontextprotocol/sdk) interfaces for ModelGuide - a platform that connects external AI agents with service connectors (e-commerce, helpdesk, etc.).

**Tech Stack:** Hono, @modelcontextprotocol/sdk, Bun.js, TypeScript, PostgreSQL

**Key Concepts:**
- Organizations provide multitenancy via Row-Level Security (RLS)
- External AI agents authenticate using **API keys** (generated per agent, shown once)
- **Connectors Catalog** is a global read-only registry from codebase; **Connectors** are org-specific configurations with credentials referenced via config JSONB
- Connectors are exposed to agents via MCP protocol for tool discovery and execution
- **Core MCP tools** are built-in platform tools (session management, escalation, CSAT)
- Some MCP tools require user confirmation before execution (`requires_confirmation` flag)

**Architecture:**
```
┌─────────────────────────────────────────────────────────────────┐
│                    CODEBASE (/connectors)                       │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │  Medusa     │  │  Zendesk    │  │  Calendly   │  ...        │
│  │  Connector  │  │  Connector  │  │  Connector  │             │
│  │  - tools[]  │  │  - tools[]  │  │  - tools[]  │             │
│  │  - schema   │  │  - schema   │  │  - schema   │             │
│  └─────────────┘  └─────────────┘  └─────────────┘             │
└─────────────────────────────────────────────────────────────────┘
                              │ read-only discovery
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    DATABASE (per org)                           │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐ │
│  │  Secrets    │  │   Agents    │  │  Connectors (config)    │ │
│  │  (creds)    │  │  + API Keys │  │  (refs catalog + config │ │
│  │             │  │             │  │   with secret UUIDs)    │ │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

Connector definitions (tools, schemas) are in the codebase catalog. The database stores:
- **Secrets**: Encrypted credentials for connector authentication
- **Agents**: Agent configuration with API keys
- **Connectors**: Org-specific config linking to catalog entries, with secret UUIDs in config JSONB

**Tool Naming Convention:**

Tools are prefixed by the **connector instance slug** (unique per organization):

```
{connector.slug}_{tool_name}
```

The connector slug is customizable per instance and defaults to the catalog connector name. This allows multiple instances of the same connector type with distinct tool names.

Examples:
- `medusa_add_to_cart` - medusa connector instance, add_to_cart tool
- `zendesk_create_ticket` - zendesk connector instance, create_ticket tool
- `core_create_session` - core (built-in) platform tool

---

## Roles

| Role | Description | Authentication |
|------|-------------|----------------|
| **Admin** | Full access: configure connectors, agents, secrets, view analytics | JWT token |
| **Support** | Read-only sessions, can create feedback, view analytics | JWT token |
| **Agent** | External AI agent: MCP access, create/update sessions | API Key (`mgk_xxx`)

---

## Authentication

### Admin/Support API Authentication

Admin and Support users authenticate using **magic link** passwordless authentication:

#### 1. Request Magic Link
```http
POST /api/auth/login
Content-Type: application/json

{
  "email": "admin@test-org.com"
}
```

**Response:** `200 OK`
```json
{
  "message": "Magic link sent"
}
```

In development mode, the magic link is printed to the console. In production, it would be sent via email.

**Security Note:** The endpoint returns the same response for valid, invalid, and inactive users to prevent email enumeration attacks.

#### 2. Verify Token & Get JWT
```http
GET /api/auth/verify?token=<magic_token>
```

**Response:** `200 OK`
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "uuid",
    "email": "admin@test-org.com",
    "name": "Admin User",
    "role": "admin",
    "organizationId": "uuid"
  }
}
```

**Error Responses:**
- `401 MAGIC_TOKEN_INVALID` - Token not found
- `401 MAGIC_TOKEN_EXPIRED` - Token has expired (default: 15 minutes)
- `401 MAGIC_TOKEN_USED` - Token has already been used

#### 3. Use JWT for Authenticated Requests
```
Authorization: Bearer <jwt_token>
```

*Note: The organization context is derived from the JWT token claims. No separate organization header is needed.*

#### 4. Get Current User
```http
GET /api/auth/me
Authorization: Bearer <jwt_token>
```

**Response:** `200 OK`
```json
{
  "id": "uuid",
  "email": "admin@test-org.com",
  "name": "Admin User",
  "role": "admin",
  "organizationId": "uuid"
}
```

#### 5. Logout
```http
POST /api/auth/logout
```

**Response:** `200 OK`
```json
{
  "message": "Logged out successfully"
}
```

*Note: JWTs are stateless, so logout is primarily for client-side cleanup.*

#### Magic Link Security Features
- Tokens are single-use (marked as used after verification)
- Tokens expire after 15 minutes (configurable via `MAGIC_LINK_EXPIRES_IN`)
- Token hashes are stored in database (not the actual tokens)
- Concurrent verification attempts are handled atomically (only one succeeds)

### Agent MCP Authentication
Agents authenticate using their unique `AGENT_KEY` (API key pattern). The agent key is unique per agent and sufficient to identify the agent - the system looks up the agent from the key hash.

```
Authorization: Bearer <agent_key>
```

---

## Combined Hono + MCP Application

API and MCP are served from a single Hono application using @modelcontextprotocol/sdk.

```typescript
import { Hono } from "hono";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { toFetchResponse, toReqRes } from "fetch-to-node";

// Create Hono app
const app = new Hono();

// Create MCP server with connector tools
const server = new McpServer(
  { name: "ModelGuide MCP", version: "1.0.0" },
  { capabilities: { logging: {} } }
);

// Register connector tools dynamically
for (const connector of connectorRegistry.getAll()) {
  for (const tool of connector.tools) {
    server.tool(tool.name, tool.description, tool.schema, tool.handler);
  }
}

// MCP endpoint
app.post("/mcp", async (c) => {
  const { req, res } = toReqRes(c.req.raw);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, await c.req.json());
  res.on("close", () => transport.close());
  return toFetchResponse(res);
});

// REST endpoints available at /api/*
// MCP available at /mcp (Streamable HTTP transport)

export default app;
```

---

## REST API Specification

### Base URL
```
/api
```

---

### 1. Connectors

Connectors are synced from codebase to database (one-time). They have:
- Metadata from code (name, tools, config_schema)
- Configuration values (populated by admin)

#### List Connectors
```http
GET /connectors
```
**Allowed roles:** `Admin`

**Response:** `200 OK`
```json
{
  "items": [
    {
      "id": "uuid",
      "name": "medusa",
      "title": "Medusa",
      "description": "Medusa.js e-commerce platform",
      "connector_type": "api",
      "config": {
        "base_url": {
          "type": "string",
          "description": "Medusa API base URL",
          "required": true,
          "value": "https://api.pizzapalace.com"
        },
        "publishable_key": {
          "type": "string",
          "required": false,
          "value": null
        },
        "api_token": {
          "type": "secret",
          "description": "API token",
          "required": true,
          "value_id": "secret-uuid"
        }
      },
      "is_configured": true,
      "tools": [
        {
          "name": "add_to_cart",
          "description": "Add item to cart",
          "input_schema": { ... },
          "default_requires_confirmation": false
        },
        {
          "name": "confirm_order",
          "description": "Confirm and place order",
          "input_schema": { ... },
          "default_requires_confirmation": true
        }
      ]
    },
    {
      "id": "uuid",
      "name": "zendesk",
      "title": "Zendesk",
      "description": "Customer support ticketing",
      "connector_type": "api",
      "config": {
        "subdomain": {
          "type": "string",
          "required": true,
          "value": null
        },
        "api_token": {
          "type": "secret",
          "required": true,
          "value_id": null
        }
      },
      "is_configured": false,
      "tools": [ ... ]
    }
  ]
}
```

*Note: `is_configured` indicates if all required config fields have values. Secret fields use `value_id` (UUID reference).*

#### Get Connector
```http
GET /connectors/{connector_id}
```
**Allowed roles:** `Admin`

**Response:** `200 OK` - Single connector with full details

#### Configure Connector
```http
PATCH /connectors/{connector_id}
```
**Allowed roles:** `Admin`

**Request Body:**
```json
{
  "config": {
    "base_url": "https://api.pizzapalace.com",
    "api_token": "secret-uuid"
  }
}
```

*Note: For secret fields, provide the secret UUID.*

**Response:** `200 OK`

#### Test Connector Connection
```http
POST /connectors/{connector_id}/health-check
```
**Allowed roles:** `Admin`

**Response:** `200 OK`
```json
{
  "status": "healthy",
  "message": "Connection successful",
  "checked_at": "2024-01-01T00:00:00Z"
}
```

---

### 2. Secrets

Encrypted credential storage. Secrets store sensitive values (API tokens, passwords) that are referenced by UUID in connector configurations. When a connector's `config_schema` has a field with `"type": "secret"`, the config value should be a secret UUID.

#### List Secrets
```http
GET /secrets
```
**Allowed roles:** `Admin`

**Response:** `200 OK`
```json
{
  "items": [
    {
      "id": "uuid",
      "name": "Medusa API Token",
      "created_at": "2024-01-01T00:00:00Z",
      "updated_at": "2024-01-01T00:00:00Z"
    }
  ]
}
```

*Note: Secret values are never returned in responses.*

#### Create Secret
```http
POST /secrets
```
**Allowed roles:** `Admin`

**Request Body:**
```json
{
  "name": "Medusa API Token",
  "value": "sk_live_xxxxxxxxxxxxx"
}
```

**Response:** `201 Created`
```json
{
  "id": "uuid",
  "name": "Medusa API Token",
  "created_at": "2024-01-01T00:00:00Z"
}
```

*Use the returned `id` (UUID) in connector config fields that have `type: secret`.*

#### Update Secret
```http
PATCH /secrets/{secret_id}
```
**Allowed roles:** `Admin`

**Request Body:**
```json
{
  "name": "Updated Name",
  "value": "new_secret_value"
}
```

**Response:** `200 OK`

#### Delete Secret
```http
DELETE /secrets/{secret_id}
```
**Allowed roles:** `Admin`

**Response:** `204 No Content`

---

### 3. Agents

#### List Agents
```http
GET /agents
```
**Allowed roles:** `Admin`

**Query Parameters:**
- `is_active` (optional): `true`, `false`
- `agent_type` (optional): `voice` (only option for V1)
- `page`, `page_size`: Pagination

**Response:** `200 OK`
```json
{
  "items": [
    {
      "id": "uuid",
      "name": "Pizza Palace Assistant",
      "description": "Voice ordering assistant for Pizza Palace",
      "agent_type": "voice",
      "is_active": true,
      "created_at": "2024-01-01T00:00:00Z",
      "updated_at": "2024-01-01T00:00:00Z"
    }
  ],
  "total": 3,
  "page": 1,
  "page_size": 20
}
```

#### Create Agent
```http
POST /agents
```
**Allowed roles:** `Admin`

**Request Body:**
```json
{
  "name": "Pizza Palace Assistant",
  "description": "Voice ordering assistant for Pizza Palace",
  "agent_type": "voice"
}
```

**Response:** `201 Created`
```json
{
  "id": "uuid",
  "name": "Pizza Palace Assistant",
  "description": "Voice ordering assistant for Pizza Palace",
  "agent_type": "voice",
  "is_active": false,
  "api_key": "mgk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "created_at": "2024-01-01T00:00:00Z"
}
```

**IMPORTANT:**
- The `api_key` is returned ONLY on creation. It cannot be retrieved again. If lost, a new key must be regenerated.
- API key is used by external voice platforms (Vapi, Retell, custom) to authenticate with Model Guide API.
- Agent is created inactive by default.

#### Get Agent
```http
GET /agents/{agent_id}
```
**Allowed roles:** `Admin`

**Response:** `200 OK`
```json
{
  "id": "uuid",
  "name": "Pizza Palace Assistant",
  "description": "Voice ordering assistant for Pizza Palace",
  "agent_type": "voice",
  "is_active": true,
  "connectors": [
    {
      "connector_id": "uuid",
      "connector_slug": "medusa",
      "tools": ["medusa_add_to_cart", "medusa_get_cart", "medusa_confirm_order"]
    },
    {
      "connector_id": "uuid",
      "connector_slug": "zendesk",
      "tools": ["zendesk_create_ticket"]
    }
  ],
  "created_at": "2024-01-01T00:00:00Z",
  "updated_at": "2024-01-01T00:00:00Z"
}
```

#### Update Agent
```http
PATCH /agents/{agent_id}
```
**Allowed roles:** `Admin`

**Request Body:**
```json
{
  "name": "Updated Name",
  "description": "Updated description"
}
```

**Response:** `200 OK`

#### Delete Agent
```http
DELETE /agents/{agent_id}
```
**Allowed roles:** `Admin`

**Response:** `204 No Content`

#### Activate Agent
```http
POST /agents/{agent_id}/activate
```
**Allowed roles:** `Admin`

**Response:** `200 OK`
```json
{
  "id": "uuid",
  "is_active": true
}
```

#### Deactivate Agent
```http
POST /agents/{agent_id}/deactivate
```
**Allowed roles:** `Admin`

**Response:** `200 OK`

#### Regenerate API Key
```http
POST /agents/{agent_id}/regenerate-key
```
**Allowed roles:** `Admin`

**Response:** `200 OK`
```json
{
  "api_key": "mgk_yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy",
  "key_prefix": "mgk_yyyy"
}
```

*Warning: This invalidates the previous key immediately.*

---

### 4. Agent Connectors (Tool Assignment)

Links connectors to agents and specifies which tools are enabled and their confirmation settings.

#### List Agent's Assigned Connectors
```http
GET /agents/{agent_id}/connectors
```
**Allowed roles:** `Admin`

**Response:** `200 OK`
```json
{
  "items": [
    {
      "id": "uuid",
      "connector_id": "uuid",
      "connector_slug": "medusa",
      "tools": [
        {
          "name": "add_to_cart",
          "is_enabled": true,
          "requires_confirmation": false
        },
        {
          "name": "get_cart",
          "is_enabled": true,
          "requires_confirmation": false
        },
        {
          "name": "confirm_order",
          "is_enabled": true,
          "requires_confirmation": true
        }
      ],
      "created_at": "2024-01-01T00:00:00Z"
    }
  ]
}
```

*Note: Tool names are prefixed by connector instance slug (e.g., `medusa_add_to_cart`). The slug is customizable and defaults to the catalog connector name.*

#### Assign Connector to Agent
```http
POST /agents/{agent_id}/connectors
```
**Allowed roles:** `Admin`

**Request Body:**
```json
{
  "connector_id": "uuid",
  "tools": [
    {
      "name": "add_to_cart",
      "is_enabled": true,
      "requires_confirmation": false
    },
    {
      "name": "get_cart",
      "is_enabled": true,
      "requires_confirmation": false
    },
    {
      "name": "confirm_order",
      "is_enabled": true,
      "requires_confirmation": true
    }
  ]
}
```

**Response:** `201 Created`

#### Update Agent Connector Tools
```http
PATCH /agents/{agent_id}/connectors/{agent_connector_id}
```
**Allowed roles:** `Admin`

**Request Body:**
```json
{
  "tools": [
    {
      "name": "confirm_order",
      "is_enabled": true,
      "requires_confirmation": true
    },
    {
      "name": "cancel_order",
      "is_enabled": true,
      "requires_confirmation": true
    }
  ]
}
```

**Response:** `200 OK`

#### Remove Connector from Agent
```http
DELETE /agents/{agent_id}/connectors/{agent_connector_id}
```
**Allowed roles:** `Admin`

**Response:** `204 No Content`

---

### 5. Sessions

#### List Sessions
```http
GET /sessions
```
**Allowed roles:** `Admin`, `Support`

**Query Parameters:**
- `agent_id` (optional): Filter by agent
- `status` (optional): `active`, `completed`, `escalated`, `abandoned`
- `channel_type` (optional): `voice`, `web`, `api`, `slack`, `widget`, `sms`, `whatsapp`
- `has_feedback` (optional): `true`, `false`
- `feedback_rating` (optional): `positive`, `negative`
- `feedback_source` (optional): `customer`, `support`
- `started_after` (optional): ISO datetime
- `started_before` (optional): ISO datetime
- `page`, `page_size`: Pagination
- `sort_by`: `started_at`, `ended_at`, `duration`
- `sort_order`: `asc`, `desc`

**Response:** `200 OK`
```json
{
  "items": [
    {
      "id": "uuid",
      "external_id": "session_123",
      "agent_id": "uuid",
      "agent": {
        "id": "uuid",
        "name": "Pizza Palace Assistant"
      },
      "channel_type": "voice",
      "status": "completed",
      "user_identifier": "user_456",
      "escalation_ref": null,
      "started_at": "2024-01-01T10:00:00Z",
      "ended_at": "2024-01-01T10:15:00Z",
      "duration_seconds": 900,
      "message_count": 12,
      "feedback_summary": {
        "customer_rating": 2,
        "support_rating": null
      }
    }
  ],
  "total": 150,
  "page": 1,
  "page_size": 20
}
```

#### Get Session Detail
```http
GET /sessions/{session_id}
```
**Allowed roles:** `Admin`, `Support`

**Response:** `200 OK`
```json
{
  "id": "uuid",
  "external_id": "session_123",
  "agent_id": "uuid",
  "agent": {
    "id": "uuid",
    "name": "Pizza Palace Assistant"
  },
  "channel_type": "voice",
  "status": "completed",
  "user_identifier": "user_456",
  "user_metadata": {
    "name": "John Doe",
    "phone": "+1234567890"
  },
  "escalation_ref": null,
  "started_at": "2024-01-01T10:00:00Z",
  "ended_at": "2024-01-01T10:15:00Z",
  "duration_seconds": 900,
  "metadata": {},
  "messages": [
    {
      "id": "uuid",
      "role": "assistant",
      "content": "Hi, welcome to Pizza Palace! How can I help you today?",
      "audio_url": "https://...",
      "tool_calls": null,
      "created_at": "2024-01-01T10:00:00Z"
    },
    {
      "id": "uuid",
      "role": "user",
      "content": "I'd like to order a large pepperoni pizza",
      "audio_url": "https://...",
      "created_at": "2024-01-01T10:00:15Z"
    },
    {
      "id": "uuid",
      "role": "assistant",
      "content": "I've added a large pepperoni pizza to your cart.",
      "tool_calls": [
        {
          "tool_name": "add_to_cart",
          "tool_id": "uuid",
          "required_confirmation": false,
          "input": {
            "item": "pizza",
            "size": "large",
            "toppings": ["pepperoni"],
            "quantity": 1
          },
          "output": {
            "cart_id": "cart_123",
            "item_id": "item_456",
            "subtotal": 18.99
          },
          "status": "success",
          "executed_at": "2024-01-01T10:00:16Z"
        }
      ],
      "created_at": "2024-01-01T10:00:17Z"
    }
  ],
  "feedback": [
    {
      "id": "uuid",
      "rating": 2,
      "comment": "Great service!",
      "feedback_source": "customer",
      "feedback_tags": [],
      "created_at": "2024-01-01T10:16:00Z"
    }
  ]
}
```

#### Create Session
```http
POST /sessions
```
**Allowed roles:** `Agent` (via AGENT_KEY)

**Request Body:**
```json
{
  "external_id": "session_123",
  "channel_type": "voice",
  "user_identifier": "user_456",
  "user_metadata": {
    "name": "John Doe"
  }
}
```

**Response:** `201 Created`

#### Update Session Status
```http
PATCH /sessions/{session_id}
```
**Allowed roles:** `Agent` (via AGENT_KEY)

**Request Body:**
```json
{
  "status": "completed",
  "escalation_ref": "ZD-5678"
}
```

**Response:** `200 OK`

---

### 6. Session Messages

#### Add Message to Session
```http
POST /sessions/{session_id}/messages
```
**Allowed roles:** `Agent` (via AGENT_KEY)

**Request Body:**
```json
{
  "role": "user",
  "content": "I'd like to order a large pepperoni pizza",
  "audio_url": "https://..."
}
```

Or for assistant message with tool calls:
```json
{
  "role": "assistant",
  "content": "I've added a large pepperoni pizza to your cart.",
  "tool_calls": [
    {
      "tool_name": "add_to_cart",
      "input": { ... },
      "output": { ... },
      "status": "success"
    }
  ]
}
```

**Response:** `201 Created`

---

### 7. Session Feedback

Feedback is created by Admin or Support users to evaluate sessions. Agents cannot create feedback.

#### List Session Feedback
```http
GET /sessions/{session_id}/feedback
```
**Allowed roles:** `Admin`, `Support`

**Response:** `200 OK`
```json
{
  "items": [
    {
      "id": "uuid",
      "session_id": "uuid",
      "message_id": null,
      "rating": 2,
      "comment": "Customer was satisfied",
      "feedback_source": "support",
      "feedback_ref": "support_user_id",
      "feedback_tags": ["good_resolution"],
      "created_at": "2024-01-01T10:16:00Z"
    }
  ]
}
```

#### Create Feedback
```http
POST /sessions/{session_id}/feedback
```
**Allowed roles:** `Admin`, `Support`

**Request Body:**
```json
{
  "rating": 1,
  "comment": "Agent used wrong tool for this scenario",
  "feedback_source": "support",
  "feedback_tags": ["wrong_tool", "missed_intent"]
}
```

**Response:** `201 Created`

**Feedback Sources:**
- `support` - Internal quality evaluation by support team
- `system` - Automated evaluation (future)

**Feedback Tags (examples):**
- Negative: `wrong_tool`, `poor_tone`, `hallucination`, `missed_intent`, `slow_response`, `failed_tool`
- Positive: `good_resolution`, `efficient`, `polite`, `correct_tool_usage`

---

### 8. Analytics

#### Get Analytics Summary
```http
GET /analytics/summary
```
**Allowed roles:** `Admin`, `Support` (read-only)

**Query Parameters:**
- `agent_id` (optional): Filter by agent
- `channel_type` (optional): Filter by channel
- `from_date`, `to_date`: Date range (required)

**Response:** `200 OK`
```json
{
  "period": {
    "from": "2024-01-01",
    "to": "2024-01-31"
  },
  "total_sessions": 1500,
  "sessions_by_status": {
    "completed": 1200,
    "escalated": 150,
    "abandoned": 100,
    "active": 50
  },
  "sessions_by_channel": {
    "voice": 800,
    "web": 500,
    "api": 200
  },
  "resolution_rate": 0.80,
  "escalation_rate": 0.10,
  "abandonment_rate": 0.067,
  "avg_duration_seconds": 420,
  "csat_score": 1.85,
  "support_evaluation_score": 1.72,
  "feedback_count": {
    "customer": 450,
    "support": 120
  }
}
```

#### Get Analytics Trends
```http
GET /analytics/trends
```
**Allowed roles:** `Admin`, `Support` (read-only)

**Query Parameters:**
- `metric`: `sessions`, `csat`, `resolution_rate`, `escalation_rate`, `duration`
- `granularity`: `hour`, `day`, `week`, `month`
- `agent_id`, `channel_type` (optional)
- `from_date`, `to_date`: Date range

**Response:** `200 OK`
```json
{
  "metric": "sessions",
  "granularity": "day",
  "data": [
    { "date": "2024-01-01", "value": 50 },
    { "date": "2024-01-02", "value": 65 },
    { "date": "2024-01-03", "value": 48 }
  ]
}
```

---

## MCP Specification (@modelcontextprotocol/sdk)

The MCP server exposes connector tools to authenticated agents for discovery and execution.

**Allowed roles:** `Agent` (via AGENT_KEY)

### MCP Server Configuration

**Transport:** SSE (Server-Sent Events) over HTTP

**Endpoint:** `/mcp` (served from the same Hono app as REST API)

**Authentication:**
```
Authorization: Bearer <agent_key>
```

Only agents with valid AGENT_KEY can access MCP. The agent is identified from the key hash. Admin and Support users do not have MCP access.

---

### MCP Resources

Resources allow agents to discover available tools and their configuration.

#### Resource: Agent Configuration
```
URI: agent://config
```

**Content:**
```json
{
  "agent_id": "uuid",
  "agent_name": "Pizza Palace Assistant",
  "organization_id": "uuid",
  "status": "active",
  "available_tool_count": 5
}
```

#### Resource: Available Tools List
```
URI: tools://list
```

Returns tools from connectors assigned to this agent (as configured via API), plus core platform tools.

**Content:**
```json
{
  "tools": [
    {
      "name": "core_create_session",
      "connector": "core",
      "description": "Create authenticated backend session",
      "requires_confirmation": false,
      "input_schema": { ... }
    },
    {
      "name": "core_end_session",
      "connector": "core",
      "description": "End the current session",
      "requires_confirmation": false,
      "input_schema": { ... }
    },
    {
      "name": "medusa_add_to_cart",
      "connector": "medusa",
      "description": "Add an item to the shopping cart",
      "requires_confirmation": false,
      "input_schema": {
        "type": "object",
        "properties": {
          "item": { "type": "string", "description": "Item name or ID" },
          "size": { "type": "string" },
          "quantity": { "type": "integer", "minimum": 1 },
          "toppings": { "type": "array", "items": { "type": "string" } }
        },
        "required": ["item", "quantity"]
      }
    },
    {
      "name": "medusa_confirm_order",
      "connector": "medusa",
      "description": "Confirm and place order",
      "requires_confirmation": true,
      "input_schema": {
        "type": "object",
        "properties": {
          "draft_order_id": { "type": "string" }
        },
        "required": ["draft_order_id"]
      }
    },
    {
      "name": "zendesk_create_ticket",
      "connector": "zendesk",
      "description": "Create support ticket",
      "requires_confirmation": false,
      "input_schema": { ... }
    }
  ]
}
```

#### Resource: Tool Detail
```
URI: tools://{tool_name}
```

**Content:** Individual tool details with full schema.

---

### MCP Tools

#### Tool Naming Convention
Tools are prefixed by the **connector instance slug** (single underscore):

```
{connector.slug}_{tool_name}
```

The connector slug is customizable per instance and defaults to the catalog connector name. This allows multiple instances of the same connector type with distinct tool names.

Examples:
- `medusa_add_to_cart` - medusa connector instance, add_to_cart tool
- `medusa_confirm_order` - medusa connector instance, confirm_order tool
- `zendesk_create_ticket` - zendesk connector instance, create_ticket tool
- `core_create_session` - core (built-in) platform tool

---

### Core MCP Tools (Built-in)

Platform-level tools provided by Model Guide for session management:

#### `core_create_session`
Create a session for tracking the conversation. Returns a session_id used in all subsequent MCP calls.

```json
{
  "name": "core_create_session",
  "description": "Create a new session",
  "input_schema": {
    "type": "object",
    "properties": {}
  }
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "session_id": "uuid"
  }
}
```

*Note: The session_id must be passed to all subsequent tool calls (e.g., `core_end_session`, connector tools).*

#### `core_end_session`
End the session with full message history (status: completed or abandoned).

```json
{
  "name": "core_end_session",
  "description": "End the session with full message history",
  "input_schema": {
    "type": "object",
    "properties": {
      "session_id": { "type": "string" },
      "messages": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "role": { "type": "string", "enum": ["user", "assistant", "system", "tool"] },
            "content": { "type": "string" },
            "timestamp": { "type": "string", "format": "date-time" },
            "tool_calls": { "type": "array" }
          },
          "required": ["role", "content", "timestamp"]
        }
      }
    },
    "required": ["session_id", "messages"]
  }
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "session_id": "uuid",
    "status": "completed"
  }
}
```

#### `core_escalate_session`
Mark session for escalation to human support.

```json
{
  "name": "core_escalate_session",
  "description": "Escalate session to human support",
  "input_schema": {
    "type": "object",
    "properties": {
      "session_id": { "type": "string" }
    },
    "required": ["session_id"]
  }
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "session_id": "uuid",
    "status": "escalated"
  }
}
```

#### `core_rate_session`
Record CSAT rating from customer.

```json
{
  "name": "core_rate_session",
  "description": "Record customer rating",
  "input_schema": {
    "type": "object",
    "properties": {
      "session_id": { "type": "string" },
      "rating": { "type": "integer", "enum": [1, 2], "description": "1=negative, 2=positive" }
    },
    "required": ["session_id", "rating"]
  }
}
```

---

#### Tool: Execute Connector Action

All connector tools follow a standard pattern:

**Tool Name:** `{connector.slug}_{action}`

**Input Schema:** Defined by connector tool

**Execution Flow:**

```
┌─────────────────────────────────────────────────────────────┐
│  Agent calls tool with parameters                           │
│                           ↓                                 │
│  MCP Server validates agent authentication                  │
│                           ↓                                 │
│  MCP Server checks tool is assigned to agent                │
│                           ↓                                 │
│  MCP Server checks requires_confirmation flag               │
│                           ↓                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ If requires_confirmation = true:                     │   │
│  │   Return confirmation_required response              │   │
│  │   Agent must call tool again with confirmation_id    │   │
│  └─────────────────────────────────────────────────────┘   │
│                           ↓                                 │
│  Execute tool against connector                             │
│                           ↓                                 │
│  Return result                                              │
└─────────────────────────────────────────────────────────────┘
```

---

#### Tool Response Format

**Standard Success Response:**
```json
{
  "success": true,
  "data": {
    "cart_id": "cart_123",
    "item_id": "item_456",
    "subtotal": 18.99
  },
  "metadata": {
    "execution_time_ms": 150,
    "connector": "medusa",
    "tool": "add_to_cart"
  }
}
```

**Confirmation Required Response:**
```json
{
  "success": false,
  "confirmation_required": true,
  "confirmation_id": "conf_xxxxx",
  "confirmation_message": "This action requires user confirmation",
  "action_summary": {
    "tool": "medusa_confirm_order",
    "description": "Confirm order for $34.74",
    "parameters": {
      "draft_order_id": "draft_789",
      "total": 34.74
    }
  },
  "expires_at": "2024-01-01T10:05:00Z"
}
```

**Confirmed Execution:**
When the agent receives user confirmation, it calls the tool again with `confirmation_id`:

```json
{
  "draft_order_id": "draft_789",
  "_confirmation_id": "conf_xxxxx"
}
```

**Error Response:**
```json
{
  "success": false,
  "error": {
    "code": "INVALID_PARAMETERS",
    "message": "Missing required field: item",
    "details": { ... }
  }
}
```

---

---

### Connector-Specific Tools

Tool names are prefixed by the **connector instance slug**. The examples below use the catalog connector name as the slug (which is the default). The slug can be customized per connector instance (e.g., `pizzapalace_add_to_cart` for a Medusa instance with slug `pizzapalace`).

#### Medusa Connector Tools

Based on [Medusa Store API](https://docs.medusajs.com/api/store):

| Tool Name | Description | Requires Confirmation |
|-----------|-------------|----------------------|
| `medusa_add_to_cart` | Add item to cart | No |
| `medusa_get_cart` | Get cart contents | No |
| `medusa_create_draft_order` | Create draft order | No |
| `medusa_set_delivery_address` | Set delivery address | No |
| `medusa_confirm_order` | Confirm and place order | **Yes** |
| `medusa_get_order` | Get order details | No |
| `medusa_update_order_address` | Update delivery address | **Yes** |
| `medusa_cancel_order` | Cancel an order | **Yes** |

#### Zendesk Connector Tools

| Tool Name | Description | Requires Confirmation |
|-----------|-------------|----------------------|
| `zendesk_create_ticket` | Create support ticket | No |
| `zendesk_get_ticket` | Get ticket details | No |
| `zendesk_update_ticket` | Update ticket | No |
| `zendesk_add_comment` | Add comment to ticket | No |
| `zendesk_close_ticket` | Close ticket | **Yes** |

#### Calendly Connector Tools

| Tool Name | Description | Requires Confirmation |
|-----------|-------------|----------------------|
| `calendly_check_availability` | Check available time slots | No |
| `calendly_book_appointment` | Book an appointment | **Yes** |
| `calendly_cancel_appointment` | Cancel an appointment | **Yes** |

---

## Error Codes

### HTTP Status Codes

| Code | Description |
|------|-------------|
| 200 | Success |
| 201 | Created |
| 204 | No Content |
| 400 | Bad Request - Invalid parameters |
| 401 | Unauthorized - Invalid or missing authentication |
| 403 | Forbidden - Insufficient permissions |
| 404 | Not Found |
| 409 | Conflict - Resource already exists |
| 422 | Unprocessable Entity - Validation error |
| 429 | Too Many Requests - Rate limited |
| 500 | Internal Server Error |

### Application Error Codes

| Code | Description |
|------|-------------|
| `AGENT_NOT_FOUND` | Agent does not exist |
| `AGENT_INACTIVE` | Agent is not active |
| `AGENT_KEY_INVALID` | Invalid agent key |
| `TOOL_NOT_ASSIGNED` | Tool not assigned to agent |
| `TOOL_DISABLED` | Tool is disabled for this agent |
| `CONFIRMATION_REQUIRED` | Action requires user confirmation |
| `CONFIRMATION_EXPIRED` | Confirmation token expired |
| `CONFIRMATION_INVALID` | Invalid confirmation token |
| `CONNECTOR_ERROR` | Error from external connector |
| `SESSION_NOT_FOUND` | Session does not exist |
| `SESSION_ENDED` | Session already ended |
| `ORGANIZATION_MISMATCH` | Resource belongs to different org |

---

## Rate Limiting

| Endpoint Type | Limit |
|--------------|-------|
| Admin API | 1000 requests/minute |
| Agent API | 500 requests/minute per agent |
| MCP Tool Calls | 100 calls/minute per agent |

---

## Database Schema

See [Database Schema](./DB_SCHEMA.md) for the complete database schema.

---

## Verification Plan

1. **API Testing:**
   - Test connector discovery endpoint (read-only from code registry)
   - Test secrets CRUD operations
   - Test agents CRUD with AGENT_KEY generation
   - Test agent connector assignment
   - Verify RLS blocks cross-organization access
   - Verify rate limiting

2. **MCP Testing:**
   - Test tool discovery via `tools://list` resource
   - Test tool execution with valid agent key
   - Verify confirmation flow for protected tools (requires_confirmation=true)
   - Test session management tools (create, update, add_message, add_feedback)

3. **Integration Testing:**
   - End-to-end flow: Create secret → Create agent → Assign connector with tools → Execute via MCP
   - Test escalation flow with Zendesk connector
   - Verify feedback collection (customer and support)

4. **Security Testing:**
   - Verify AGENT_KEY only returned on creation, cannot be retrieved
   - Test invalid agent key scenarios
   - Verify organization isolation via RLS
   - Test that agents can only access assigned connectors/tools
