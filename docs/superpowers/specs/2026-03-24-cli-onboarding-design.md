# ModelGuide CLI — Customer Onboarding Tool

## Context

Setting up a new ModelGuide org currently requires either editing TypeScript vertical configs or using the REST API/dashboard manually. This CLI provides a fast, scriptable way to provision orgs for customer onboarding — from org creation to agents, SOPs, guardrails, and demo sessions.

**Design principles:**
- Thin CLI — delegates to existing service layer, no duplicated business logic
- Simple entities (org, users, secrets, agents) work directly from CLI args — no files needed
- Batch operations use key=value pairs as positional args
- Complex entities (SOPs, guardrails, sessions) import from YAML files
- `mg setup <dir>` orchestrates everything from a YAML directory
- All batch commands support `--from <file>` as an alternative to inline args

## Dependencies

- **Commander.js** — CLI framework (subcommands, help, validation)
- **@clack/prompts** — interactive prompts (secret input, confirmations, spinners)
- **js-yaml** — YAML parsing

## Architecture

### Service layer delegation

The CLI is a thin orchestration layer. All business logic goes through existing services:

| Operation | Service | Function |
|---|---|---|
| Create user | `users.service` | `createUser(orgId, { email, name, role })` |
| Create secret | `secrets.service` | `createSecret(orgId, { name, value, secretType, scope? })` |
| Create connector | `connectors.service` | `createConnector(orgId, { connectorCatalogId, name, slug, config?, secrets? })` — auto-materializes tools |
| Create agent | `agents.service` | `createAgent(orgId, { name, slug?, modality?, ... }, createdBy)` — auto-generates API key |
| Assign tools | `agents.service` | `assignConnectorToAgent(orgId, agentId, { connectorId, tools })` |
| Create SOP | `sops.service` | `createSop(orgId, { name, slug?, definition, agentIds? })` |
| Fork SOP template | `sops.service` | `forkFromTemplate(orgId, templateId, { connectorMapping, agentIds? })` |
| Activate SOP | `sops.service` | `activateSop(orgId, sopId)` |
| Assign agents to SOP | `sops.service` | `setAssignedAgents(orgId, sopId, agentIds)` |
| Create guardrail | `knowledge-base.service` | `createKnowledgeBase(orgId, { type, name, content, config, agentIds? })` |
| Compile agent | `compiler` | `compile(compilerInput)` (same as `seed-compile-agents.ts`) |

**Exception — org creation:** No `createOrganization` service exists. This is the one place the CLI uses direct DB access (`forApp` with insert into `organizations` table), following the pattern from `seed-org.ts`.

### Environment

The CLI requires full `.env` validation — same as the API. It imports `src/env.ts` which validates all required env vars (DATABASE_URL, ENCRYPTION_KEY, JWT_SECRET, etc.). This ensures crypto, DB, and all services work correctly.

Services use the shared global `db` singleton from `src/db/client.ts` with `forOrg(orgId, ...)` for RLS-scoped operations.

## Command Interface

All commands use batch/plural form. No singular variants.

### Org (required for everything else)

```bash
mg create-org --name "Acme Corp" --slug acme \
  [--timezone "America/Chicago"] \
  [--features voice-agents,chat-agents] \
  [--demo]

mg create-org --from org.yaml
```

### Users (batch with key=value)

```bash
mg add-users --org acme \
  "email=alice@acme.com,name=Alice Admin,role=admin" \
  "email=bob@acme.com,name=Bob Support,role=support" \
  "email=carol@acme.com,name=Carol Viewer,role=viewer"

mg add-users --org acme --from users.yaml
```

### Secrets (batch, values prompted interactively)

```bash
mg add-secrets --org acme \
  "name=Medusa API Key,type=api_key,scope=connector" \
  "name=Zendesk Token,type=api_key,scope=connector"
# → @clack/prompts password input for each value

mg add-secrets --org acme --from secrets.yaml
# secrets.yaml declares names/types; values still prompted
```

### Connectors (batch from YAML or inline with JSON config)

```bash
mg add-connectors --org acme --from connectors.yaml
# → prompts for secret values interactively

mg add-connectors --org acme \
  "name=Acme Store,slug=acme_store,catalog=medusa,config={\"baseUrl\":\"https://api.acme.com\"}"
```

### Agents (batch with key=value)

```bash
mg add-agents --org acme \
  "name=Voice Agent,slug=acme-voice,modality=voice" \
  "name=Chat Assistant,slug=acme-chat,modality=text"

mg add-agents --org acme --from agents.yaml
```

### SOPs, Guardrails, Sessions (YAML only)

```bash
mg import-sops --org acme sops.yaml
mg import-guardrails --org acme guardrails.yaml
mg import-sessions --org acme sessions.yaml
```

### Operations

```bash
mg compile-agents --org acme [--agent <agent-slug>]
```

### Full Orchestrator

```bash
mg setup <dir>
  --dry-run          # validate + print plan, no writes
  --skip-secrets     # placeholder values for dev/testing
  --skip-compile     # skip agent compilation
  --skip-sessions    # skip session import
```

## Key=Value Parsing

Positional args use `key=value` pairs separated by commas:
```
"email=alice@acme.com,name=Alice Admin,role=admin"
```

**Rules:**
- Split on first `=` only — values can contain `=` signs
- Commas inside values: use `\,` to escape (e.g., `name=Acme\, Inc.`)
- Quotes not required around the whole arg if no shell-special chars
- Zod validation catches missing required keys or invalid enum values

## YAML Schemas

### `org.yaml`

```yaml
name: "Acme Corp"
slug: "acme"
timezone: "America/Chicago"
features:
  - voice-agents
  - chat-agents
demoEnabled: false
```

### `users.yaml`

```yaml
users:
  - email: admin@acme.com
    name: "Alice Admin"
    role: admin
  - email: support@acme.com
    name: "Bob Support"
    role: support
```

### `connectors.yaml`

```yaml
connectors:
  - name: "Acme Store"
    slug: "acme_store"
    catalogSlug: "medusa"
    config:
      baseUrl: "https://api.acme.example.com"
      publishableKey: "pk_xxx"
    secrets:
      - field: "apiKey"
        name: "Acme Store API Key"
        type: api_key
  - name: "Acme Support"
    slug: "acme_support"
    catalogSlug: "zendesk"
    config:
      subdomain: "acme"
      email: "support@acme.example.com"
    secrets:
      - field: "apiToken"
        name: "Acme Zendesk Token"
        type: api_key
```

### `agents.yaml`

```yaml
agents:
  - name: "Acme Voice Agent"
    slug: "acme-voice-agent"
    description: "Handles phone orders and support"
    modality: voice
    platform: custom
    tools:
      - connectorSlug: "acme_store"
      - connectorSlug: "acme_support"
        toolSlugs:
          - create_ticket
          - search_tickets
```

### `sops.yaml`

```yaml
sops:
  # Fork from global template
  - name: "Order Lookup"
    slug: "order-lookup"
    templateSlug: "order-lookup"
    connectorMapping:
      medusa: "acme_store"
    status: active
    agents:
      - "acme-voice-agent"

  # Define inline
  - name: "Return Process"
    slug: "return-process"
    description: "Handle return requests"
    status: draft
    trigger:
      type: intent_detected
      config:
        patterns: ["return", "refund"]
    metadata:
      reasonCode: "RET-001"
      tags: ["return", "refund"]
    steps:
      - id: "greet"
        instruction: "Greet the customer."
        required: true
      - id: "lookup-order"
        instruction: "Look up the order."
        required: true
        tool:
          connectorSlug: "acme_store"
          toolSlug: "get_order"
    agents:
      - "acme-voice-agent"
```

### `guardrails.yaml`

```yaml
guardrails:
  - name: "No Medical Claims"
    slug: "no-medical-claims"
    content: |
      Never claim any product treats, cures, or prevents a medical condition.
    description: "FDA compliance"
    config:
      priority: critical
      category: compliance
    agents:
      - "acme-voice-agent"
      - "acme-chat-assistant"
```

### `sessions.yaml`

```yaml
sessions:
  - agentSlug: "acme-voice-agent"
    channel: voice
    status: completed
    userIdentifier: "sarah@example.com"
    hoursAgo: 2
    messages:
      - role: user
        content: "Hi, I want to check on my order ORD-1234."
      - role: assistant
        content: "Hello Sarah! Let me look that up..."
    feedback:
      verdict: good
      comment: "Very helpful!"
      source: customer
```

## Pipeline (`mg setup`)

### Dependency order

```
1. Create org                    ← org.yaml (required) — direct DB (no service exists)
2. Create users                  ← users.yaml (required) — users.service.createUser
3. Create secrets + connectors   ← connectors.yaml (optional) — secrets.service + connectors.service
4. Create agents + tool links    ← agents.yaml (optional) — agents.service.createAgent + assignConnectorToAgent
5. Import SOPs                   ← sops.yaml (optional) — sops.service.createSop / forkFromTemplate
6. Import guardrails             ← guardrails.yaml (optional) — knowledge-base.service.createKnowledgeBase
7. Compile agents                ← auto — compiler.compile (same as seed-compile-agents.ts)
8. Import sessions               ← sessions.yaml (optional) — sessions.service + feedback.service
```

### IdRegistry

Runtime map `{ entityType: { slug: uuid } }` — populated as each step creates/finds entities. All YAML cross-references use slugs, never UUIDs.

### Idempotency

Services throw on duplicate slugs. The CLI catches these errors, looks up the existing entity, registers its UUID, and logs "Found existing." For org creation (direct DB), uses `onConflictDoUpdate` from the seed pattern.

### Error handling

Forward-only, no rollback. On failure: prints error + completed steps, exits code 1. Fix and re-run — previously created entities are found and skipped.

### Dry-run

Validates YAML, checks catalog slugs exist, prints plan summary, no writes.

## Directory Structure

```
modelguide-api/src/cli/
├── mg.ts                       # Entry point — Commander program, import.meta.main guard
├── lib/
│   ├── yaml-loader.ts          # Load + Zod-validate YAML from file/dir
│   ├── logger.ts               # Colored output via @clack/prompts
│   ├── prompt.ts               # Interactive secret input wrapper
│   ├── id-registry.ts          # slug → UUID registry
│   └── parse-kv.ts             # Parse "key=val,key=val" with escape handling
├── schemas/
│   ├── org.schema.ts
│   ├── users.schema.ts
│   ├── connectors.schema.ts
│   ├── agents.schema.ts
│   ├── sops.schema.ts
│   ├── guardrails.schema.ts
│   └── sessions.schema.ts
├── commands/
│   ├── setup.ts                # mg setup <dir>
│   ├── create-org.ts           # mg create-org
│   ├── add-users.ts            # mg add-users
│   ├── add-secrets.ts          # mg add-secrets
│   ├── add-connectors.ts       # mg add-connectors
│   ├── add-agents.ts           # mg add-agents
│   ├── import-sops.ts          # mg import-sops
│   ├── import-guardrails.ts    # mg import-guardrails
│   ├── compile-agents.ts       # mg compile-agents
│   └── import-sessions.ts      # mg import-sessions
└── examples/
    └── acme/                   # Example config directory
```

## Services Used

| Service | File | Functions used by CLI |
|---|---|---|
| Users | `src/features/users/users.service.ts` | `createUser` |
| Secrets | `src/features/secrets/secrets.service.ts` | `createSecret` |
| Connectors | `src/features/connectors/connectors.service.ts` | `listCatalog`, `createConnector`, `listConnectorTools` |
| Agents | `src/features/agents/agents.service.ts` | `createAgent`, `assignConnectorToAgent` |
| SOPs | `src/features/sops/sops.service.ts` | `createSop`, `forkFromTemplate`, `activateSop`, `setAssignedAgents`, `listTemplates` |
| Knowledge Base | `src/features/knowledge-base/knowledge-base.service.ts` | `createKnowledgeBase` |
| Compiler | `src/features/compiler/core/compile.ts` | `compile` |
| Sessions | `src/features/sessions/sessions.service.ts` | `createSession`, `addMessage`, `updateSession` |
| Feedback | `src/features/feedback/feedback.service.ts` | `addFeedback` |
| Direct DB | `src/db/schema` + `src/db/rls.ts` | Org creation only (`forApp`) — pending #171 |

## Integration

```makefile
# Makefile
mg:
	cd modelguide-api && bun run src/cli/mg.ts $(filter-out $@,$(MAKECMDGOALS))
```

```json
// package.json scripts
"mg": "bun run src/cli/mg.ts"
```

## Security

1. **`import.meta.main` guard** — `mg.ts` top-level code only runs when executed directly. Prevents accidental execution if imported.

2. **Full `.env` validation** — CLI loads `src/env.ts` (Zod-validated). Same env vars as the API: DATABASE_URL, ENCRYPTION_KEY, JWT_SECRET, etc.

3. **RLS enforcement** — uses `forOrg()` for all org-scoped operations (same as API). No superuser bypass except for org creation (`forApp`).

4. **No API exposure** — `src/cli/` is never imported by `src/app.ts`. Architecturally isolated from the web server.

5. **Input validation** — all CLI args and YAML validated through Zod before calling services.

6. **Secret handling** — values masked during input (`@clack/prompts` password()), passed directly to `createSecret()`, never logged.

## Output Design

### Per-step output

Each step logs concisely:
- `✓ Created org: Acme Corp (acme)` or `✓ Found existing org: Acme Corp (acme)`
- `✓ Created user: alice@acme.com (admin)`
- `✓ Created secret: Acme Store API Key`
- `✓ Created connector: acme_store (medusa, 12 tools)`
- `✓ Created agent: Acme Voice Agent`

### API keys — shown once

```
  ┌─────────────────────┬──────────────────────────────────┐
  │ Agent               │ API Key                          │
  ├─────────────────────┼──────────────────────────────────┤
  │ Acme Voice Agent    │ mgk_a1b2c3d4e5f6...             │
  │ Acme Chat Assistant │ mgk_x7y8z9w0v1u2...             │
  └─────────────────────┴──────────────────────────────────┘
```

### Final summary (`mg setup`)

```
✓ Org: Acme Corp (acme)

✓ Users:
  ┌─────────────────────┬──────────────────────────┬─────────┐
  │ Name                │ Email                    │ Role    │
  ├─────────────────────┼──────────────────────────┼─────────┤
  │ Alice Admin         │ alice@acme.com           │ admin   │
  │ Bob Support         │ bob@acme.com             │ support │
  │ Carol Viewer        │ carol@acme.com           │ viewer  │
  └─────────────────────┴──────────────────────────┴─────────┘

✓ Connectors: 2 (acme_store, acme_support)
✓ Secrets:    2

✓ Agents + API Keys:
  ┌─────────────────────┬──────────────────────────────────┐
  │ Agent               │ API Key                          │
  ├─────────────────────┼──────────────────────────────────┤
  │ Acme Voice Agent    │ mgk_a1b2c3d4e5f6...             │
  │ Acme Chat Assistant │ mgk_x7y8z9w0v1u2...             │
  └─────────────────────┴──────────────────────────────────┘

✓ SOPs:       3 imported (2 active, 1 draft)
✓ Guardrails: 2 imported
✓ Compiled:   2 agents
✓ Sessions:   5 imported
```

## Tests

Uses `bun:test` (project standard). Tests in `tests/unit/cli/` and `tests/integration/cli/`.

### Unit tests (`tests/unit/cli/`) — no DB

| Test file | What it covers |
|---|---|
| `parse-kv.test.ts` | key=value parsing — happy path, escaped commas, values with `=`, missing keys, special chars |
| `id-registry.test.ts` | set/get/has operations, error on missing slug |
| `yaml-loader.test.ts` | Zod validation on good/bad YAML (mock file reads) |
| `schemas.test.ts` | Each Zod schema: valid input passes, bad input rejected |

### Integration tests (`tests/integration/cli/`) — Testcontainers PostgreSQL

| Test file | What it covers |
|---|---|
| `create-org.test.ts` | Creates org, verifies in DB, idempotent re-run |
| `add-users.test.ts` | Batch key=value users, verify roles via users.service |
| `add-connectors.test.ts` | Creates connector via connectors.service, verifies tools materialized |
| `import-sops.test.ts` | Template fork + inline creation via sops.service |
| `import-guardrails.test.ts` | Creates guardrails via knowledge-base.service |
| `compile-agents.test.ts` | Compiles agent, verifies compiledInstructions non-null |
| `setup.test.ts` | Full pipeline from example YAML dir; second run idempotent |

**Integration test approach:**
- Import command handler functions directly
- Use existing `integration-preload.ts` (Testcontainers + migrations + seed)
- Mock `@clack/prompts` `password()` to return test values
- `afterAll` cleanup: delete test org + cascade

## Verification

1. `bun test tests/unit/cli/` — all unit tests pass
2. `bun test tests/integration/cli/` — all integration tests pass
3. `mg setup examples/acme/` against local Postgres — all entities created
4. Run again — idempotent, "Found existing" everywhere
5. `mg setup examples/acme/ --dry-run` — prints plan, no DB changes
6. Dashboard shows the new org with all data
