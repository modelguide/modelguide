# ModelGuide Database Schema

This document defines the canonical database schema for ModelGuide.

---

## Overview

- **Multitenancy:** All tables (except `connectors_catalog`) are scoped to organizations via `organization_id` with Row-Level Security (RLS)
- **Timestamps:** All tables use `TIMESTAMP WITH TIME ZONE` for `created_at`/`updated_at`
- **UUIDs:** All primary keys are UUIDs

---

## Tables

### organizations

Root entity for multitenancy. All other tables (except `connectors_catalog`) have `organization_id` FK with RLS.

| Field | Type | Description |
|-------|------|-------------|
| id | UUID | Primary key |
| name | VARCHAR | Organization name |
| slug | VARCHAR | URL-friendly identifier |
| settings | JSONB | General org settings |
| created_at | TIMESTAMP | |
| updated_at | TIMESTAMP | |

**Constraints:**
- `slug` UNIQUE

---

### users

Platform users (Admin, Support). Customers interact via agents, not the platform.

| Field | Type | Description |
|-------|------|-------------|
| id | UUID | Primary key |
| organization_id | UUID | FK → organizations |
| email | VARCHAR | User email |
| name | VARCHAR | Display name |
| role | ENUM | `admin`, `support` |
| is_active | BOOLEAN | Soft delete flag |
| last_login_at | TIMESTAMP | |
| created_at | TIMESTAMP | |
| updated_at | TIMESTAMP | |

**Constraints:**
- `(organization_id, email)` UNIQUE
- RLS on `organization_id`

**Notes:**
- `role` determines API permissions (see Roles matrix in PRD)
- Deactivated users retain records for audit; sessions/feedback still reference them
- No `customer` role - customers interact via agents, not the platform

---

### magic_tokens

Magic link tokens for passwordless authentication.

| Field | Type | Description |
|-------|------|-------------|
| id | UUID | Primary key |
| user_id | UUID | FK → users |
| token_hash | VARCHAR(64) | SHA-256 hash of the magic token |
| expires_at | TIMESTAMP | Token expiration time |
| used_at | TIMESTAMP | When token was used (null if unused) |
| created_at | TIMESTAMP | |

**Constraints:**
- `token_hash` UNIQUE
- Index on `user_id`

**Notes:**
- Tokens are single-use: once `used_at` is set, token cannot be used again
- Token expiration is configurable (default: 15 minutes)
- Only the hash is stored, not the actual token
- Concurrent verification is handled atomically via conditional update
- Expired tokens should be cleaned up periodically

---

### connectors_catalog

Global read-only registry of connector types. Defined in codebase, synced to DB.

| Field | Type | Description |
|-------|------|-------------|
| id | UUID | Primary key |
| name | VARCHAR | Display name (e.g., "Medusa") |
| slug | VARCHAR | Unique identifier, used as default for connector.slug |
| description | TEXT | What this connector does |
| connector_type | ENUM | `api`, `webhook`, `database`, `messaging` |
| config_schema | JSONB | Required fields to configure an instance |
| tools | JSONB | Array of tool templates (see structure below) |
| auth_methods | ARRAY | `api_key`, `oauth2`, `basic`, `none` |
| icon_url | VARCHAR | Display icon URL |
| is_active | BOOLEAN | Available in catalog |
| created_at | TIMESTAMP | |

**Constraints:**
- `slug` UNIQUE (global)

**Notes:**
- **Read-only** - defined in codebase, synced to DB
- No `organization_id` - this is a global registry
- `tools` JSONB structure:
  ```json
  [
    {
      "name": "add_to_cart",
      "description": "Add item to cart",
      "input_schema": { ... },
      "default_requires_confirmation": false,
      "default_timeout_seconds": 30
    }
  ]
  ```
- When connector instance created, tools are copied to `connector_tools` table
- `config_schema` example:
  ```json
  {
    "base_url": { "type": "string", "required": true },
    "api_token": { "type": "secret", "required": true }
  }
  ```

---

### connectors

Organization-specific connector instances. Links to catalog and stores configuration.

| Field | Type | Description |
|-------|------|-------------|
| id | UUID | Primary key |
| organization_id | UUID | FK → organizations |
| connector_catalog_id | UUID | FK → connectors_catalog |
| name | VARCHAR | Custom display name (e.g., "Pizza Palace Store") |
| slug | VARCHAR | Unique per org, used as tool name prefix |
| config | JSONB | Instance-specific configuration values |
| is_active | BOOLEAN | |
| created_at | TIMESTAMP | |
| updated_at | TIMESTAMP | |

**Constraints:**
- `(organization_id, slug)` UNIQUE
- RLS on `organization_id`

**Notes:**
- `slug` is used to prefix all tools: `{slug}_{tool_name}` → `pizzapalace_add_to_cart`
- UI should default `slug` to `connectors_catalog.slug` on creation
- `config` values must match `connectors_catalog.config_schema`
- Secret fields in `config` store secret UUIDs (not actual values)
- `is_configured` can be computed: all required fields in config_schema have non-null values
- When created, tools from catalog are copied to `connector_tools`
- Validation of `config` against `config_schema` happens at application layer

---

### connector_tools

Tools available from a connector instance. Seeded from catalog, customizable per instance.

| Field | Type | Description |
|-------|------|-------------|
| id | UUID | Primary key |
| organization_id | UUID | FK → organizations |
| connector_id | UUID | FK → connectors |
| name | VARCHAR | Tool display name |
| slug | VARCHAR | URL-friendly identifier (e.g., "add_to_cart") |
| description | TEXT | |
| tool_schema | JSONB | OpenAI function calling format |
| connection_config | JSONB | Endpoint URLs, headers, overrides |
| timeout_seconds | INTEGER | Default 30 |
| is_active | BOOLEAN | |
| created_at | TIMESTAMP | |
| updated_at | TIMESTAMP | |

**Constraints:**
- `(connector_id, slug)` UNIQUE
- RLS on `organization_id`

**Notes:**
- Full MCP tool name: `{connector.slug}_{connector_tool.slug}`
- Seeded from `connectors_catalog.tools` when connector instance created
- Can be customized per instance (timeouts, endpoint overrides)
- `tool_schema` follows OpenAI function calling format
- `connection_config` example:
  ```json
  {
    "endpoint": "/carts/{cart_id}/items",
    "method": "POST",
    "headers": { "X-Custom": "value" }
  }
  ```
- **Cascading:** When connector deleted, delete associated connector_tools (ON DELETE CASCADE)

---

### secrets

Encrypted credential storage using polymorphic ownership pattern.

| Field | Type | Description |
|-------|------|-------------|
| id | UUID | Primary key |
| organization_id | UUID | FK → organizations |
| name | VARCHAR | Secret name for display |
| secret_type | ENUM | `api_key`, `oauth_token`, `credentials` |
| encrypted_value | TEXT | Encrypted secret value |
| owner_type | ENUM | `connector` (extensible) |
| owner_id | UUID | ID of owning entity |
| expires_at | TIMESTAMP | Optional expiration |
| created_at | TIMESTAMP | |
| updated_at | TIMESTAMP | |

**Constraints:**
- RLS on `organization_id`
- No FK on `owner_id` (polymorphic pattern)
- Index on `(owner_type, owner_id)` for lookups

**Notes:**
- Polymorphic ownership: `owner_type` + `owner_id` identify the owner
- Currently only `connector` is supported; extensible for future (e.g., `agent`)
- `encrypted_value` uses application-level encryption (e.g., KMS)
- Secrets are referenced by UUID in `connectors.config`
- **No cascading delete** - Application must handle orphan cleanup when connector deleted
- Application must validate `owner_id` exists for given `owner_type`

---

### agents

AI agent configurations.

| Field | Type | Description |
|-------|------|-------------|
| id | UUID | Primary key |
| organization_id | UUID | FK → organizations |
| name | VARCHAR | Display name |
| description | TEXT | Optional description |
| agent_type | ENUM | `voice` (V1 only) |
| is_active | BOOLEAN | |
| system_prompt | TEXT | Main agent instructions |
| tags | ARRAY | Searchable tags |
| metadata | JSONB | Custom fields |
| created_by | UUID | FK → users |
| created_at | TIMESTAMP | |
| updated_at | TIMESTAMP | |

**Constraints:**
- RLS on `organization_id`

**Notes:**
- `agent_type` is `voice` only for V1; extensible for `chat`, `email` in future
- `is_active` must be true for agent to accept MCP connections
- `system_prompt` is the main instruction set for the agent
- API key is generated separately (see `api_keys` table)

---

### api_keys

API keys for agent authentication.

| Field | Type | Description |
|-------|------|-------------|
| id | UUID | Primary key |
| organization_id | UUID | FK → organizations |
| agent_id | UUID | FK → agents (nullable) |
| name | VARCHAR | Key name for display |
| key_hash | VARCHAR | SHA-256 of actual key |
| key_prefix | VARCHAR | First chars for identification (e.g., "mgk_xxxx") |
| is_active | BOOLEAN | |
| expires_at | TIMESTAMP | Optional expiration |
| last_used_at | TIMESTAMP | |
| created_by | UUID | FK → users |
| created_at | TIMESTAMP | |

**Constraints:**
- `key_hash` UNIQUE
- Index on `key_hash` for fast authentication lookups
- RLS on `organization_id`

**Notes:**
- Key format: `mgk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx` (32 chars after prefix)
- **Key only returned once on creation** - cannot be retrieved again
- If `agent_id` is set, key is scoped to that agent only
- If `agent_id` is null, key is org-wide (for admin API access)
- `key_prefix` stored for identification in logs/UI without exposing full key
- **Cascading:** When agent deleted, associated api_keys should be deleted or deactivated

---

### security_tokens

Refresh token sessions for UI authentication. One row per login session — no row-per-rotation bloat.

| Column | Type | Description |
|--------|------|-------------|
| family_id | UUID (PK) | Session identifier, carried in refresh JWT as `fid` |
| user_id | UUID | FK → users (CASCADE) |
| generation | INTEGER | Rotation counter for reuse detection |
| is_revoked | BOOLEAN | Set true on reuse detection or logout |
| expires_at | TIMESTAMP | Sliding expiry (extended on each rotation) |
| created_at | TIMESTAMP | |

**Constraints:**
- `family_id` PK (no separate `id` column)
- Index on `user_id` for bulk revocation
- Index on `expires_at` for cleanup queries

**Notes:**
- The refresh JWT payload is `{ type: "refresh", fid, gen, sub }` — no `exp` claim
- Expiry is enforced by DB `expires_at` only (single source of truth)
- Reuse detection: if `token.generation < db.generation - 1`, the session is revoked
- See `docs/decisions/001-refresh-token-rotation.md` for full security rationale

---

### agent_connector_tools

Links agents to specific tools they can use.

| Field | Type | Description |
|-------|------|-------------|
| id | UUID | Primary key |
| agent_id | UUID | FK → agents |
| connector_tool_id | UUID | FK → connector_tools |
| is_enabled | BOOLEAN | |
| requires_confirmation | BOOLEAN | Agent must confirm with user before executing |
| created_at | TIMESTAMP | |

**Constraints:**
- `(agent_id, connector_tool_id)` UNIQUE

**Notes:**
- Links agents to specific tools they can use
- `requires_confirmation` overrides `connector_tools.default_requires_confirmation`
- Tool is only available to agent if `is_enabled = true`
- **Validation:** `connector_tool` must belong to same org as `agent`
- **Cascading:** When connector_tool deleted, delete associated agent_connector_tools (ON DELETE CASCADE)

---

### sessions

Conversation sessions between customers and agents.

| Field | Type | Description |
|-------|------|-------------|
| id | UUID | Primary key |
| organization_id | UUID | FK → organizations |
| agent_id | UUID | FK → agents |
| external_id | VARCHAR | External voice platform session ID |
| channel_type | ENUM | `voice`, `web`, `api`, `slack`, `widget`, `sms`, `whatsapp`, `email` |
| user_identifier | VARCHAR | External user ID or token |
| user_metadata | JSONB | User context (name, phone, etc.) |
| status | ENUM | `active`, `completed`, `escalated`, `abandoned` |
| escalation_ref | VARCHAR | External ticket ID (e.g., Zendesk ticket) |
| started_at | TIMESTAMP | |
| ended_at | TIMESTAMP | |
| metadata | JSONB | Custom session data |

**Constraints:**
- RLS on `organization_id`
- Index on `(agent_id, status)` for filtering
- Index on `started_at` for sorting

**Notes:**
- `channel_type`: V1 supports `voice`, `web`, `api`, `slack`, `widget`; V2 adds `sms`, `whatsapp`, `email`
- `status` transitions: `active` → `completed` | `escalated` | `abandoned`
- `duration` is computed: `ended_at - started_at` (not stored)
- `escalation_ref` populated when session escalated to external system
- `ended_at` should be set when status changes from `active`
- Consider soft delete vs hard delete for GDPR compliance

---

### session_messages

Individual messages within a session.

| Field | Type | Description |
|-------|------|-------------|
| id | UUID | Primary key |
| session_id | UUID | FK → sessions |
| role | ENUM | `user`, `assistant`, `system`, `tool` |
| content | TEXT | Message content (transcript for voice) |
| audio_url | VARCHAR | URL to audio recording |
| audio_duration_ms | INTEGER | Audio length in milliseconds |
| tool_call_id | VARCHAR | For tool role messages |
| tool_name | VARCHAR | Which tool was called |
| tool_input | JSONB | Parameters sent to tool |
| tool_output | JSONB | Result from tool |
| model_used | VARCHAR | LLM model that generated response |
| tokens_used | INTEGER | Total tokens consumed |
| latency_ms | INTEGER | Response generation time |
| sequence_number | INTEGER | Order in session |
| created_at | TIMESTAMP | |

**Constraints:**
- Index on `session_id`
- `(session_id, sequence_number)` for ordering

**Notes:**
- `role = 'tool'` messages have `tool_call_id`, `tool_name`, `tool_input`, `tool_output`
- `role = 'assistant'` messages may have associated tool calls (linked by `tool_call_id`)
- `sequence_number` ensures correct ordering regardless of timestamps
- `audio_url` for voice channel playback
- `sequence_number` should auto-increment per session (via trigger or application)
- Consider partitioning by `session_id` for large tables

---

### session_feedback

Feedback on sessions from customers, support, or automated systems.

| Field | Type | Description |
|-------|------|-------------|
| id | UUID | Primary key |
| session_id | UUID | FK → sessions |
| message_id | UUID | FK → session_messages (nullable) |
| rating | INTEGER | 1 = negative, 2 = positive |
| comment | TEXT | Optional feedback text |
| feedback_source | ENUM | `customer`, `support`, `system` |
| feedback_ref | VARCHAR | External reference (support user ID, customer ID) |
| feedback_tags | ARRAY | Issue/quality tags |
| user_identifier | VARCHAR | Who gave feedback |
| created_at | TIMESTAMP | |

**Constraints:**
- Index on `session_id`

**Notes:**
- If `message_id` is set, feedback is for specific message; otherwise for whole session
- `feedback_source`:
  - `customer`: End-user CSAT rating
  - `support`: Internal quality evaluation
  - `system`: Automated evaluation (future)
- `feedback_tags` examples:
  - Negative: `wrong_tool`, `poor_tone`, `hallucination`, `missed_intent`
  - Positive: `good_resolution`, `efficient`, `correct_tool_usage`
- Multiple feedback entries allowed per session (customer + support)

---

## Entity Relationships

```
ConnectorsCatalog (global, read-only)
    │
    └── defines schema for ──┐
                             │
Organization                 │
    │                        │
    ├── Users                │
    │     └── MagicTokens    │
    │                        │
    ├── Secrets ─────────────────────────┐
    │   (owner_type: connector)          │
    │   (owner_id: connector.id)         │
    │                                    │
    ├── Connectors (instances) ◄─────────┤ (polymorphic link)
    │     │   └── FK → ConnectorsCatalog │
    │     └── ConnectorTools             │
    │           │                        │
    │           └─────────────┐          │
    │                         │          │
    ├── Agents                │          │
    │     │                   │          │
    │     ├── AgentConnectorTools ───────┘
    │     │
    │     └── Sessions
    │           ├── SessionMessages
    │           └── SessionFeedback
    │
    └── APIKeys
          └── (optional) FK → Agents
```

---

## Logical Gaps & Resolutions

| Gap | Resolution |
|-----|------------|
| Cascading deletes | ON DELETE CASCADE for: connector→connector_tools, agent→api_keys, connector_tool→agent_connector_tools |
| Secret orphans | **No FK on secrets** (polymorphic). Application-layer cleanup when connector deleted. |
| Config validation | Application validates `connectors.config` against `connectors_catalog.config_schema` |
| Cross-org access | RLS policies on all org-scoped tables |
| Tool uniqueness | `(connector_id, slug)` unique for connector_tools; full name `{connector.slug}_{tool.slug}` is unique per org |
| Sequence numbers | Auto-increment `session_messages.sequence_number` per session via trigger or application |
| Computed fields | `connectors.is_configured` and `sessions.duration` computed at query time, not stored |

---

## Indexes Summary

| Table | Index | Purpose |
|-------|-------|---------|
| magic_tokens | `token_hash` | Fast token lookup during verification |
| magic_tokens | `user_id` | Find tokens by user |
| api_keys | `key_hash` | Fast authentication lookups |
| secrets | `(owner_type, owner_id)` | Polymorphic ownership lookups |
| sessions | `(agent_id, status)` | Session filtering |
| sessions | `started_at` | Session sorting |
| session_messages | `session_id` | Message retrieval |
| session_messages | `(session_id, sequence_number)` | Message ordering |
| session_feedback | `session_id` | Feedback retrieval |
| security_tokens | `user_id` | Bulk session revocation |
| security_tokens | `expires_at` | Expired session cleanup |
