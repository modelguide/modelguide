# API & MCP Implementation Phases

This document outlines the implementation phases for ModelGuide API and MCP server, organized into **two parallel streams**.

## Documentation References

| Document | Description |
|----------|-------------|
| `docs/PRD.md` | Product requirements, use cases, personas, permissions matrix |
| `docs/api-spec.md` | Complete REST API and MCP specification |
| `docs/DB_SCHEMA.md` | Database schema with 12 tables |

---

# Stream 1: Core Platform

Core platform features: Database (core tables), Auth, Organizations, Users, Secrets, Connectors, Agents, MCP.

---

## S1-Phase 1: Database Schema (Core Tables)

### 1.1 Core Database Schema
**File:** `src/db/schema/core.ts`
**Reference:** `docs/DB_SCHEMA.md`

Create Drizzle ORM schema definitions for core tables:
- `organizations` - Multitenancy root entity
- `users` - Platform users (admin, support)
- `connectors_catalog` - Global connector registry (read-only)
- `connectors` - Org-specific connector instances
- `connector_tools` - Tools available per connector instance
- `secrets` - Encrypted credentials with polymorphic ownership
- `agents` - AI agent configurations
- `api_keys` - Agent authentication keys
- `agent_connector_tools` - Agent-to-tool assignments

Include indexes: key_hash, (owner_type, owner_id)

### 1.2 Generate & Run Core Migrations
```bash
make db-generate
make db-migrate
```

### 1.3 Shared Utilities
**Directory:** `src/lib/`

- `src/lib/errors.ts` - Custom error classes and error codes (ref: api-spec.md "Error Codes")
- `src/lib/crypto.ts` - API key generation (mgk_xxx prefix), hashing (SHA-256), secret encryption
- `src/lib/pagination.ts` - Pagination helpers for list endpoints

---

## S1-Phase 2: Authentication & Authorization

### 2.1 Authentication Middleware
**Directory:** `src/lib/middleware/`
**Reference:** `docs/api-spec.md` "Authentication" section

Implement two authentication modes:
1. **JWT Authentication** (Admin/Support)
   - Parse `Authorization: Bearer <jwt_token>` header
   - Validate JWT and extract user info
   - Parse `X-Organization-ID` header for org context

2. **API Key Authentication** (Agents)
   - Parse `Authorization: Bearer <agent_key>` header
   - Hash key and lookup in `api_keys` table
   - Validate key is active and not expired
   - Extract agent_id and organization_id

### 2.2 RLS Context Setup
Set PostgreSQL session variables for Row-Level Security:
```sql
SET app.organization_id = '<org_uuid>';
```

### 2.3 Role-Based Access Control
**Reference:** `docs/PRD.md` "Personas × Permissions Matrix"

Implement role checking middleware for:
- Admin: Full access
- Support: Read-only sessions, can create feedback, view analytics
- Agent: MCP access only, session management

---

## S1-Phase 3: Organizations & Users

### 3.1 Organizations Feature
**Directory:** `src/features/organizations/`
**Reference:** `docs/DB_SCHEMA.md` "organizations" table

- `GET /api/organizations/:id` - Get organization details
- Organization context middleware

### 3.2 Users Feature
**Directory:** `src/features/users/`
**Reference:** `docs/DB_SCHEMA.md` "users" table

- `GET /api/users` - List users (Admin only)
- `POST /api/users` - Create user (Admin only)
- `GET /api/users/:id` - Get user details
- `PATCH /api/users/:id` - Update user
- `DELETE /api/users/:id` - Deactivate user

---

## S1-Phase 4: Secrets Management

### 4.1 Secrets Feature
**Directory:** `src/features/secrets/`
**Reference:** `docs/api-spec.md` "2. Secrets" section

Endpoints:
- `GET /api/secrets` - List secrets (metadata only, no values)
- `POST /api/secrets` - Create secret (encrypt value before storing)
- `PATCH /api/secrets/:id` - Update secret name/value
- `DELETE /api/secrets/:id` - Delete secret

Implementation notes:
- Values never returned in responses
- Use polymorphic ownership (owner_type, owner_id)
- Secret UUIDs referenced in connector configs

---

## S1-Phase 5: Connectors System

### 5.1 Connectors Catalog Registry
**Directory:** `src/features/connectors/catalog/`
**Reference:** `docs/api-spec.md` "Connector-Specific Tools" section

Define connector specifications in code:
- `src/features/connectors/catalog/medusa.ts` - Medusa connector definition
- `src/features/connectors/catalog/zendesk.ts` - Zendesk connector definition

Each connector defines:
- `name`, `slug`, `description`, `connector_type`
- `config_schema` - Required configuration fields
- `tools[]` - Array of tool definitions with input_schema

### 5.2 Connectors Feature
**Directory:** `src/features/connectors/`
**Reference:** `docs/api-spec.md` "1. Connectors" section

Endpoints:
- `GET /api/connectors` - List connectors (catalog + configured instances)
- `GET /api/connectors/:id` - Get connector details
- `PATCH /api/connectors/:id` - Configure connector (set config values, link secrets)
- `POST /api/connectors/:id/health-check` - Test connector connection

### 5.3 Medusa Connector Implementation
**Directory:** `src/features/connectors/implementations/medusa/`
**Reference:** `docs/api-spec.md` "Medusa Connector Tools", `docs/PRD.md` UC-04, UC-05

Implement tool handlers that call Medusa Store API:
- `add_to_cart` - Add item to cart
- `get_cart` - Get cart contents
- `create_draft_order` - Create draft order from cart
- `set_delivery_address` - Set delivery address on order
- `confirm_order` - Confirm and place order (**requires_confirmation**)
- `get_order` - Get order details
- `update_order_address` - Update delivery address (**requires_confirmation**)
- `cancel_order` - Cancel an order (**requires_confirmation**)

### 5.4 Zendesk Connector Implementation
**Directory:** `src/features/connectors/implementations/zendesk/`
**Reference:** `docs/api-spec.md` "Zendesk Connector Tools", `docs/PRD.md` UC-07

Implement tool handlers that call Zendesk API:
- `create_ticket` - Create support ticket with session context
- `get_ticket` - Get ticket details
- `update_ticket` - Update ticket fields
- `add_comment` - Add comment to ticket
- `close_ticket` - Close ticket (**requires_confirmation**)

---

## S1-Phase 6: Agents Management

### 6.1 Agents Feature
**Directory:** `src/features/agents/`
**Reference:** `docs/api-spec.md` "3. Agents" section

Endpoints:
- `GET /api/agents` - List agents (with filters: is_active, agent_type)
- `POST /api/agents` - Create agent (generates API key, shown once)
- `GET /api/agents/:id` - Get agent details with assigned connectors
- `PATCH /api/agents/:id` - Update agent name/description
- `DELETE /api/agents/:id` - Delete agent
- `POST /api/agents/:id/activate` - Activate agent
- `POST /api/agents/:id/deactivate` - Deactivate agent
- `POST /api/agents/:id/regenerate-key` - Regenerate API key

API Key generation:
- Format: `mgk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx` (32 chars after prefix)
- Store SHA-256 hash in `api_keys.key_hash`
- Return key only on creation, never again

### 6.2 Agent Connectors Feature
**Reference:** `docs/api-spec.md` "4. Agent Connectors (Tool Assignment)" section

Endpoints:
- `GET /api/agents/:id/connectors` - List agent's assigned connectors/tools
- `POST /api/agents/:id/connectors` - Assign connector to agent with tool selection
- `PATCH /api/agents/:id/connectors/:connector_id` - Update tool settings
- `DELETE /api/agents/:id/connectors/:connector_id` - Remove connector from agent

Tool settings:
- `is_enabled` - Whether tool is available
- `requires_confirmation` - Override for confirmation flag

---

## S1-Phase 7: MCP Server (Standalone)

MCP server with dummy session handling - independent of Stream 2. Core tools use mock session IDs for development/testing.

### 7.1 MCP Resources
**Directory:** `src/features/mcp/`
**Reference:** `docs/api-spec.md` "MCP Resources" section

Implement MCP resources:
- `agent://config` - Agent configuration details
- `tools://list` - Available tools for authenticated agent
- `tools://{tool_name}` - Individual tool details

### 7.2 Core MCP Tools (Mock Sessions)
**Reference:** `docs/api-spec.md` "Core MCP Tools (Built-in)" section

Implement platform tools with mock session handling:
- `core_create_session` - Returns mock session_id (e.g., `mock_session_{uuid}`)
- `core_end_session` - Accepts session_id, logs/ignores if mock
- `core_escalate_session` - Accepts session_id, logs escalation request
- `core_rate_session` - Accepts session_id and rating, logs if mock

**Note:** Real session integration happens in Integration Phase after Stream 2 completes.

### 7.3 Connector Tool Execution
**Reference:** `docs/api-spec.md` "Tool: Execute Connector Action" section

Implement tool execution flow:
1. Validate agent authentication
2. Check tool is assigned to agent
3. Check `requires_confirmation` flag
4. If confirmation required, return confirmation_required response
5. Execute tool via Medusa/Zendesk implementation
6. Return result

Tool response formats:
- Standard success response with data
- Confirmation required response with confirmation_id
- Error response with error code

### 7.4 MCP Transport
Replace placeholder in `src/app.ts` with full MCP implementation:
- Use `StreamableHTTPServerTransport` from @modelcontextprotocol/sdk
- Authenticate via API key in Authorization header
- Register connector tools dynamically based on agent's assignments
- Include core tools with mock session handling

---

# Stream 2: Sessions & Analytics

Sessions and analytics features: Database (session tables), Sessions, Feedback, Analytics.

**Runs in parallel with Stream 1** - completely independent.

---

## S2-Phase 1: Database Schema (Session Tables)

### 1.1 Session Database Schema
**File:** `src/db/schema/sessions.ts`
**Reference:** `docs/DB_SCHEMA.md`

Create Drizzle ORM schema definitions for session tables:
- `sessions` - Conversation sessions
- `session_messages` - Individual messages in sessions
- `session_feedback` - CSAT and support evaluations

Include indexes: (agent_id, status), started_at, session_id, (session_id, sequence_number)

### 1.2 Generate & Run Session Migrations
```bash
make db-generate
make db-migrate
```

---

## S2-Phase 2: Sessions & Messages

### 2.1 Sessions Feature
**Directory:** `src/features/sessions/`
**Reference:** `docs/api-spec.md` "5. Sessions" section

Endpoints:
- `GET /api/sessions` - List sessions with filters (Admin/Support)
  - Filters: agent_id, status, channel_type, has_feedback, date range
  - Pagination and sorting
- `GET /api/sessions/:id` - Get session detail with messages (Admin/Support)
- `POST /api/sessions` - Create session (Agent via API key)
- `PATCH /api/sessions/:id` - Update session status (Agent via API key)

Session statuses: `active`, `completed`, `escalated`, `abandoned`
Channel types: `voice`, `web`, `api`, `slack`, `widget`, `sms`, `whatsapp`, `email`

### 2.2 Session Messages Feature
**Reference:** `docs/api-spec.md` "6. Session Messages" section

Endpoints:
- `POST /api/sessions/:id/messages` - Add message to session (Agent only)

Message roles: `user`, `assistant`, `system`, `tool`
Include tool_calls for assistant messages with tool invocations

---

## S2-Phase 3: Feedback System

### 3.1 Feedback Feature
**Directory:** `src/features/feedback/`
**Reference:** `docs/api-spec.md` "7. Session Feedback" section

Endpoints:
- `GET /api/sessions/:id/feedback` - List feedback for session
- `POST /api/sessions/:id/feedback` - Create feedback (Admin/Support)

Feedback sources: `customer`, `support`, `system`
Feedback tags: `wrong_tool`, `poor_tone`, `hallucination`, `good_resolution`, etc.
Rating: 1 (negative), 2 (positive)

---

## S2-Phase 4: Analytics

### 4.1 Analytics Feature
**Directory:** `src/features/analytics/`
**Reference:** `docs/api-spec.md` "8. Analytics" section

Endpoints:
- `GET /api/analytics/summary` - Get aggregated metrics
  - total_sessions, sessions_by_status, sessions_by_channel
  - resolution_rate, escalation_rate, abandonment_rate
  - avg_duration_seconds, csat_score, support_evaluation_score
- `GET /api/analytics/trends` - Get time-series data
  - Metrics: sessions, csat, resolution_rate, escalation_rate, duration
  - Granularity: hour, day, week, month

Filters: agent_id, channel_type, from_date, to_date

---

# Integration Phase

After both streams complete, connect MCP to real sessions.

---

## Integration: Connect MCP to Sessions

### Replace Mock Session Handling
**Files:** `src/features/mcp/tools/core.ts`

Update core MCP tools to use real session service:
- `core_create_session` - Create real session in database via Sessions service
- `core_end_session` - End real session, store messages via Sessions service
- `core_escalate_session` - Update real session status to escalated
- `core_rate_session` - Create real feedback record via Feedback service

---

# Testing & Verification

After integration complete:

## API Testing
**Reference:** `docs/api-spec.md` "Verification Plan" section

- Test connector discovery endpoint
- Test secrets CRUD operations
- Test agents CRUD with API key generation
- Test agent connector assignment
- Verify RLS blocks cross-organization access

## MCP Testing
- Test tool discovery via `tools://list` resource
- Test tool execution with valid agent key
- Verify confirmation flow for protected tools
- Test session management tools (with real sessions)

## Integration Testing
- End-to-end: Create secret → Create agent → Assign Medusa connector → Execute via MCP
- Test escalation flow with Zendesk connector
- Verify feedback collection (customer and support)

## Security Testing
- Verify API key only returned on creation
- Test invalid agent key scenarios
- Verify organization isolation via RLS
- Test agents can only access assigned tools

---

# Stream Dependencies

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           STREAM 1 (Core)                                │
│                                                                          │
│  S1-P1 (DB Core) → S1-P2 (Auth) → S1-P3 (Orgs/Users)                    │
│        ↓                                                                 │
│  S1-P4 (Secrets) → S1-P5 (Connectors + Medusa + Zendesk)                │
│        ↓                                                                 │
│  S1-P6 (Agents) → S1-P7 (MCP Standalone) ────────────────┐              │
│                                                          │              │
└──────────────────────────────────────────────────────────┼──────────────┘
                                                           │
┌──────────────────────────────────────────────────────────┼──────────────┐
│                       STREAM 2 (Sessions & Analytics)    │              │
│                                                          │              │
│  S2-P1 (DB Sessions) → S2-P2 (Sessions) ─────────────────┤              │
│           ↓                                              │              │
│  S2-P3 (Feedback) → S2-P4 (Analytics)                    │              │
│                                                          │              │
└──────────────────────────────────────────────────────────┼──────────────┘
                                                           │
                                                           ↓
                                              ┌────────────────────────┐
                                              │   INTEGRATION          │
                                              │   Connect MCP ↔ Sessions│
                                              └────────────────────────┘
```

---

# Summary

## Stream 1: Core Platform (Independent)

| Phase | Description | Key Files |
|-------|-------------|-----------|
| S1-P1 | Database Schema (Core) | `src/db/schema/core.ts` |
| S1-P2 | Authentication | `src/lib/middleware/auth.ts` |
| S1-P3 | Organizations & Users | `src/features/organizations/`, `src/features/users/` |
| S1-P4 | Secrets | `src/features/secrets/` |
| S1-P5 | Connectors + Implementations | `src/features/connectors/`, `implementations/medusa/`, `implementations/zendesk/` |
| S1-P6 | Agents | `src/features/agents/` |
| S1-P7 | MCP Server (Standalone) | `src/features/mcp/`, `src/app.ts` |

## Stream 2: Sessions & Analytics (Independent)

| Phase | Description | Key Files |
|-------|-------------|-----------|
| S2-P1 | Database Schema (Sessions) | `src/db/schema/sessions.ts` |
| S2-P2 | Sessions & Messages | `src/features/sessions/` |
| S2-P3 | Feedback | `src/features/feedback/` |
| S2-P4 | Analytics | `src/features/analytics/` |

## Integration

| Phase | Description | Key Files |
|-------|-------------|-----------|
| INT | Connect MCP to Sessions | `src/features/mcp/tools/core.ts` |
