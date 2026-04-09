# YAML Schema Reference

Complete field-by-field specification for every CLI YAML file. Source of truth: `modelguide-api/src/cli/schemas/*.schema.ts`.

## Table of Contents

- [org.yaml](#orgyaml)
- [users.yaml](#usersyaml)
- [secrets.yaml](#secretsyaml)
- [connectors.yaml](#connectorsyaml)
- [agents.yaml](#agentsyaml)
- [sops.yaml](#sopsyaml)
- [guardrails.yaml](#guardrailsyaml)
- [evals.yaml](#evalsyaml)
- [sessions.yaml](#sessionsyaml)

---

## org.yaml

Top-level object (not wrapped in a key).

| Field | Type | Required | Default | Constraint |
|-------|------|----------|---------|------------|
| `name` | string | yes | — | min 1 char |
| `slug` | string | yes | — | regex `/^[a-z0-9-]+$/` (lowercase, digits, hyphens) |
| `timezone` | string | no | — | IANA timezone (e.g., `America/Chicago`) |
| `features` | string[] | no | — | e.g., `["voice-agents", "chat-agents"]` |
| `demoEnabled` | boolean | no | `false` | enables demo mode for the org |

**Behavior:** Upsert on `slug` — if org exists, name/settings/demo flag are updated. A warning is logged on update.

---

## users.yaml

Wrapper key: `users` (array, min 1 item).

| Field | Type | Required | Default | Constraint |
|-------|------|----------|---------|------------|
| `email` | string | yes | — | valid email format |
| `name` | string | yes | — | min 1 char |
| `role` | enum | yes | — | `"admin"` \| `"support"` |

**Behavior:** Duplicates detected by email (catches PostgreSQL unique constraint error). Existing users are counted and their IDs registered for downstream use.

---

## secrets.yaml

Wrapper key: `secrets` (array, min 1 item).

| Field | Type | Required | Default | Constraint |
|-------|------|----------|---------|------------|
| `name` | string | yes | — | min 1 char, unique within org |
| `value` | string | no | — | if omitted: prompted interactively, or placeholder with `--skip-secrets` |
| `type` | enum | yes | — | `"api_key"` \| `"oauth_token"` \| `"credentials"` \| `"platform_api_key"` \| `"webhook_secret"` |
| `scope` | enum | no | — | `"connector"` \| `"agent"` |

**Behavior:** Secrets are append-only (no stable dedup key). Use `--skip-secrets` on re-runs to avoid creating duplicates. Placeholder format: `placeholder_<name_snake_cased>`.

---

## connectors.yaml

Wrapper key: `connectors` (array, min 1 item).

### Connector item

| Field | Type | Required | Default | Constraint |
|-------|------|----------|---------|------------|
| `name` | string | yes | — | min 1 char |
| `slug` | string | yes | — | regex `/^[a-z0-9_]+$/` (lowercase, digits, underscores) |
| `catalogSlug` | string | yes | — | must match an entry in the connector catalog (see `references/catalog.md`) |
| `config` | object | no | `{}` | arbitrary key-value pairs (e.g., `baseUrl`, `subdomain`) |
| `secrets` | array | no | `[]` | connector-scoped secrets (see below) |

### Connector secret

| Field | Type | Required | Default | Constraint |
|-------|------|----------|---------|------------|
| `field` | string | yes | — | field name in the connector's config that references this secret |
| `name` | string | yes | — | human-readable secret name |
| `type` | enum | yes | — | same enum as standalone secrets |
| `value` | string | no | — | if omitted: prompted or placeholder |

**Behavior:** Checks if connector slug already exists before creating secrets (avoids orphaned secrets). Each connector secret becomes a separate secret entity; the `field → secretId` mapping is passed to `createConnector`.

**Note on slug format:** Connector slugs use underscores (`acme_store`), not hyphens. This is because connector slugs become part of tool names (`acme_store_get_order`).

---

## agents.yaml

Wrapper key: `agents` (array, min 1 item).

### Agent item

| Field | Type | Required | Default | Constraint |
|-------|------|----------|---------|------------|
| `name` | string | yes | — | min 1 char |
| `slug` | string | no | — | auto-generated from name if omitted |
| `description` | string | no | — | |
| `modality` | enum | no | `"voice"` | `"voice"` \| `"text"` |
| `platform` | enum | no | `"custom"` | `"custom"` \| `"elevenlabs"` \| `"livekit"` |
| `active` | boolean | no | `false` | whether to activate the agent immediately after creation |
| `tools` | array | no | `[]` | tool assignments (see below) |
| `config` | object | conditional | — | **required** when `platform: "livekit"` (see LiveKit config below) |
| `secrets` | array | no | `[]` | agent-scoped secrets (see below) |

### LiveKit config

Required when `platform: "livekit"`.

| Field | Type | Required | Constraint |
|-------|------|----------|------------|
| `url` | string | yes | LiveKit server WebSocket URL (e.g., `wss://my-project.livekit.cloud`) |
| `agentName` | string | yes | Agent name registered in LiveKit (min 1 char) |

### Agent secret

| Field | Type | Required | Default | Constraint |
|-------|------|----------|---------|------------|
| `field` | string | yes | — | field name in the agent's secrets map that references this secret |
| `name` | string | yes | — | human-readable secret name |
| `type` | enum | yes | — | same enum as standalone secrets |
| `value` | string | no | — | if omitted: prompted or placeholder |

### Tool link

| Field | Type | Required | Default | Constraint |
|-------|------|----------|---------|------------|
| `connectorSlug` | string | yes | — | must match a connector created earlier in the pipeline |
| `toolSlugs` | string[] | no | — | if omitted, **all tools** from the connector are assigned |

**Behavior:** Auto-generates an API key on creation (printed once in a table). Duplicates detected by slug. On re-run, existing agents are found and their IDs registered but tool assignments are NOT re-applied. Each agent secret becomes a separate secret entity; the `field → secretId` mapping is stored in the agent's `secrets` map.

**Important:** Agents require a `createdBy` user ID. In `mg setup`, this is automatically resolved from the first user in the registry. When running standalone, the first user in the org is used.

---

## sops.yaml

Wrapper key: `sops` (array, min 1 item).

Two mutually exclusive modes: **template fork** or **inline**. Cannot specify both `templateSlug` and `steps`.

### Common fields

| Field | Type | Required | Default | Constraint |
|-------|------|----------|---------|------------|
| `name` | string | yes | — | min 1 char |
| `slug` | string | no | — | auto-generated if omitted |
| `description` | string | no | — | |
| `status` | enum | no | `"draft"` | `"draft"` \| `"active"` \| `"archived"` |
| `agents` | string[] | no | `[]` | agent slugs to assign (must exist) |

### Template fork fields

| Field | Type | Required | Default | Constraint |
|-------|------|----------|---------|------------|
| `templateSlug` | string | yes (for fork) | — | must match a global SOP template (see `references/catalog.md`) |
| `connectorMapping` | object | no | — | maps catalog slugs in the template to your org's connector slugs |

**`connectorMapping` example:** If the template references tools from catalog `medusa`, and your org's Medusa connector slug is `acme_store`:
```yaml
connectorMapping:
  medusa: "acme_store"
```

### Inline fields

| Field | Type | Required | Default | Constraint |
|-------|------|----------|---------|------------|
| `trigger` | object | no | `{type: "manual", config: {}}` | see trigger types below |
| `metadata` | object | no | `{}` | arbitrary key-value pairs |
| `steps` | array | yes (for inline) | — | at least one step |

### Trigger object

| Field | Type | Required |
|-------|------|----------|
| `type` | string | yes | any string, e.g., `"manual"`, `"intent"`, `"channel"`, `"tool_present"` |
| `config` | object | no (default `{}`) | type-specific configuration |

### Step object

| Field | Type | Required | Default | Constraint |
|-------|------|----------|---------|------------|
| `id` | string | yes | — | unique within the SOP |
| `instruction` | string | yes | — | what the agent should do |
| `required` | boolean | no | `true` | whether the step is mandatory |
| `tool` | object | no | — | tool reference (see below) |

### Step tool reference

| Field | Type | Required |
|-------|------|----------|
| `connectorSlug` | string | yes | the org's connector slug |
| `toolSlug` | string | yes | the tool within that connector |

**Behavior:** If `status: active`, the SOP is activated after creation. Agent assignment happens during creation (passed to `forkFromTemplate` or `createSop`).

---

## guardrails.yaml

Wrapper key: `guardrails` (array, min 1 item).

| Field | Type | Required | Default | Constraint |
|-------|------|----------|---------|------------|
| `name` | string | yes | — | min 1 char |
| `slug` | string | no | — | auto-generated if omitted |
| `content` | string | yes | — | the guardrail rule text (supports multiline) |
| `description` | string | no | — | |
| `config` | object | no | `{}` | arbitrary (e.g., `priority`, `category`) |
| `agents` | string[] | no | `[]` | agent slugs to assign |

**Behavior:** Creates a knowledge base entry with type `"guardrail"`. Duplicates detected by slug.

---

## evals.yaml

Top-level object with `agentSlug`, `evaluators`, and `test_cases`. One file per agent. For multi-agent orgs, use multiple files with the `evals*.yaml` naming pattern (e.g., `evals-insurance.yaml`, `evals-booking.yaml`).

| Field | Type | Required | Constraint |
|-------|------|----------|------------|
| `agentSlug` | string | yes | must match an existing agent slug |
| `evaluators` | array | yes | at least 1 evaluator |
| `test_cases` | array | yes | at least 1 test case |

### Evaluator item

| Field | Type | Required | Constraint |
|-------|------|----------|------------|
| `name` | string | yes | min 1, max 255 chars. Used as reference key in test cases |
| `criterion` | string | yes | min 1 char. The judgment criterion for the LLM judge evaluator |
| `tags` | string[] | no | `[]` | max 20 tags, each max 100 chars. Grouping labels (e.g., `compliance`, `quality`, `tone-of-voice`) |

### Test case item

| Field | Type | Required | Default | Constraint |
|-------|------|----------|---------|------------|
| `id` | string | yes | — | min 1, max 255 chars. Used as `externalId` for dedup |
| `sop_slug` | string | yes | — | must match an existing SOP slug |
| `scenario_key` | string | no | — | grouping key (e.g., `order_status`, `return_flow`) |
| `campaign` | string | no | — | campaign identifier |
| `tags` | string[] | no | `[]` | arbitrary tags for filtering |
| `guardrails_tested` | string[] | no | `[]` | guardrail slugs this test case validates |
| `evaluators` | string[] | yes | — | min 1. Must reference evaluator names defined in the `evaluators` section |
| `input` | object | yes | — | see input object below |

### Input object

| Field | Type | Required | Constraint |
|-------|------|----------|------------|
| `customer_message` | string | conditional | min 1 char. Either this or `candidate_message` required |
| `candidate_message` | string | conditional | min 1 char. Either this or `customer_message` required |
| `conversation_history` | array | no | array of `{role, content}` messages |
| `context` | object | no | arbitrary key-value context data |

### Conversation history message

| Field | Type | Required | Constraint |
|-------|------|----------|------------|
| `role` | enum | yes | `"user"` \| `"assistant"` \| `"system"` \| `"tool"` |
| `content` | string | yes | min 1 char |

**Behavior:** Groups test cases by `sop_slug` — one eval suite per (agent, SOP) pair. Evaluators become `llm_judge` eval configs (prefixed `import:<name>`). All evaluators referenced by any test case in a group become suite-level evaluators. Per-test-case evaluator references are stored in `expectedBehavior`. Suites deduped by (agentId, sopId). Test cases deduped by `externalId` in JSONB input. Eval configs deduped by name.

**Also supports JSON format** (`eval-scenarios.json`) for standalone import with `--agent` flag. JSON scenarios have inline `expected_output.criteria` arrays that are auto-extracted as evaluators.

---

## sessions.yaml

Wrapper key: `sessions` (array, min 1 item).

### Session item

| Field | Type | Required | Default | Constraint |
|-------|------|----------|---------|------------|
| `agentSlug` | string | yes | — | must match an existing agent |
| `externalId` | string | no | — | max 255 chars. If omitted, derived deterministically from payload (SHA-256 hash, prefix `mg-import:`) |
| `channel` | enum | yes | — | `"voice"` \| `"web"` \| `"api"` \| `"slack"` \| `"widget"` \| `"sms"` \| `"whatsapp"` \| `"email"` |
| `status` | enum | no | `"completed"` | `"active"` \| `"completed"` \| `"abandoned"` |
| `userIdentifier` | string | yes | — | min 1 char (e.g., email, phone) |
| `hoursAgo` | number | no | `1` | how far back to timestamp the session |
| `messages` | array | yes | — | at least one message |
| `feedback` | object | no | — | see below |
| `links` | array | no | `[]` | see below |

### Message

| Field | Type | Required |
|-------|------|----------|
| `role` | enum | yes | `"user"` \| `"assistant"` \| `"system"` \| `"tool"` |
| `content` | string | yes | min 1 char |

### Feedback

| Field | Type | Required | Default |
|-------|------|----------|---------|
| `verdict` | enum | yes | — | `"good"` \| `"bad"` |
| `comment` | string | no | — | |
| `source` | enum | no | `"customer"` | `"customer"` \| `"support"` \| `"system"` |

### Link

| Field | Type | Required |
|-------|------|----------|
| `url` | string | yes | valid URL |
| `title` | string | no | |
| `connectorSlug` | string | no | |
| `resourceType` | string | no | e.g., `"order"`, `"ticket"` |

**Behavior:** Sessions are created in `"simulation"` mode. Messages are timestamped with 15-second intervals starting from `Date.now() - hoursAgo * 3600000`. Deduplication is by `(agentId, externalId)` pair — providing explicit `externalId` values is recommended for predictable idempotency.
