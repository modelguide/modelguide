---
name: mg-cli
description: >
  Generate YAML configuration files and run CLI commands to onboard organizations into ModelGuide.
  Use this skill when the user asks to set up an org, create agents, import SOPs, add connectors,
  prepare onboarding YAML, provision a customer, seed demo data, or anything related to the `mg` CLI tool.
  Also trigger when the user mentions "mg setup", "mg import", "mg add", "onboard", "provision org",
  "create YAML for CLI", "prepare config files", or asks how to get a new organization running in ModelGuide.
---

# ModelGuide CLI Onboarding Tool

The `mg` CLI is a thin orchestration layer over ModelGuide's service layer. It reads YAML files, validates them with Zod, and calls existing `@features/*` services in dependency order. All business logic lives in the services — the CLI handles parsing, validation, orchestration, and output.

## When to Use This Skill

- User wants to onboard a new organization (customer, demo, test)
- User wants to prepare YAML config files for the CLI
- User wants to run individual CLI commands or the full `mg setup` pipeline
- User wants to import SOPs, guardrails, evals, sessions, or other entities
- User asks about available connectors, SOP templates, or schema fields

## Workflow Overview

There are two ways to use the CLI:

### Option A: Full Setup (recommended for new orgs)

Create a directory with YAML files anywhere on disk, then run one command:

```bash
cd modelguide-api
bun run src/cli/mg.ts setup /path/to/my-org/           # provision everything
bun run src/cli/mg.ts setup /path/to/my-org/ --dry-run  # validate and preview without changes
```

The directory can live anywhere — it does not need to be inside the modelguide repo. Pass an absolute or relative path.

**Required file:** `org.yaml`
**Optional files:** `users.yaml`, `secrets.yaml`, `connectors.yaml`, `agents.yaml`, `sops.yaml`, `guardrails.yaml`, `evals.yaml` (or `evals-*.yaml` for multi-agent orgs), `sessions.yaml`

**Flags:**
- `--dry-run` — validate all YAML files against schemas and print the plan without touching the database. Use this to verify files are correct before running for real.
- `--skip-secrets` — use placeholder values (useful for CI/testing)
- `--skip-compile` — skip agent compilation step
- `--skip-evals` — skip eval import
- `--skip-sessions` — skip demo session import

### Option B: Individual Commands

Run each step separately (useful for adding to an existing org):

```bash
cd modelguide-api
bun run src/cli/mg.ts create-org --from /path/to/org.yaml
bun run src/cli/mg.ts add-users --org acme --from /path/to/users.yaml
bun run src/cli/mg.ts add-secrets --org acme --from /path/to/secrets.yaml
bun run src/cli/mg.ts add-connectors --org acme --from /path/to/connectors.yaml
bun run src/cli/mg.ts add-agents --org acme --from /path/to/agents.yaml
bun run src/cli/mg.ts import-sops --org acme /path/to/sops.yaml
bun run src/cli/mg.ts import-guardrails --org acme /path/to/guardrails.yaml
bun run src/cli/mg.ts import-evals --org acme /path/to/evals.yaml
bun run src/cli/mg.ts compile-agents --org acme
bun run src/cli/mg.ts import-sessions --org acme /path/to/sessions.yaml
```

## Pipeline Dependency Order

The order matters because later steps reference entities created earlier:

```
1. org.yaml        — organization (everything scoped to this)
2. users.yaml      — users (agents need a createdBy user)
3. secrets.yaml    — standalone secrets (connectors may reference these)
4. connectors.yaml — connectors + connector-scoped secrets
5. agents.yaml     — agents + tool assignments (references connectors)
6. sops.yaml       — SOPs (references agents + connector tools)
7. guardrails.yaml — guardrails (references agents)
8. evals.yaml     — eval suites, evaluators, test cases (references agents + SOPs)
9. compile-agents  — compiles each agent against its active SOPs (skipped with --skip-compile)
10. sessions.yaml  — demo sessions (references agents)
```

The `mg setup` command handles this order automatically and threads an `IdRegistry` (slug-to-UUID map) across all steps so cross-references resolve without extra DB queries.

## Idempotency

Re-running is safe:
- **Orgs:** upsert on slug (updates settings if exists, warns)
- **Users/Agents/Connectors/SOPs/Guardrails:** duplicate errors are caught and counted as "existing"
- **Evals:** suites deduped by (agent, SOP) pair; test cases by `externalId` in JSONB; eval configs by name
- **Sessions:** deduped by `externalId` (explicit or derived from payload hash)
- **Secrets:** append-only (no stable dedup key — use `--skip-secrets` on re-runs)

## Quick Schema Reference

Each YAML file has a specific structure. For the **complete field-by-field reference** with types, defaults, constraints, and edge cases, read `references/schemas.md`.

### org.yaml
```yaml
name: "Acme Corp"
slug: "acme"                    # lowercase + hyphens only
timezone: "America/Chicago"     # optional
features: [voice-agents]        # optional
demoEnabled: false              # optional, default false
```

### users.yaml
```yaml
users:
  - email: admin@acme.example.com
    name: "Alice Admin"
    role: admin                 # admin | support
```

### secrets.yaml
```yaml
secrets:
  - name: OpenAI API Key
    type: platform_api_key      # api_key | oauth_token | credentials | platform_api_key | webhook_secret
    scope: agent                # connector | agent (optional)
    # value: omitted = prompted interactively (or placeholder with --skip-secrets)
```

### connectors.yaml
```yaml
connectors:
  - name: "Acme Store"
    slug: "acme_store"          # lowercase + underscores
    catalogSlug: "medusa"       # must match a catalog entry — see references/catalog.md
    config:
      baseUrl: "https://api.acme.example.com"
    secrets:                    # connector-scoped secrets created automatically
      - field: "secretApiKey"    # field name in connector config
        name: "Acme Store API Key"
        type: api_key
```

### agents.yaml
```yaml
agents:
  - name: "Acme Voice Agent"
    slug: "acme-voice-agent"
    description: "Handles phone orders"
    modality: voice             # voice | text (default: voice)
    platform: custom            # custom | elevenlabs (default: custom)
    tools:
      - connectorSlug: "acme_store"           # all tools from this connector
      - connectorSlug: "acme_support"
        toolSlugs: [create_ticket, get_ticket] # specific tools only
```

### sops.yaml — two modes

**Inline SOP** (define steps directly):
```yaml
sops:
  - name: "Order Lookup"
    slug: "order-lookup"
    status: active              # draft | active | archived (default: draft)
    agents: ["acme-voice-agent"]
    trigger:
      type: intent_detected          # see references/schemas.md for all trigger types
      config:
        patterns: ["where is my order", "track my order", "order status"]
    steps:
      - id: greet
        instruction: "Greet and ask for order number"
        required: true
      - id: lookup
        instruction: "Look up the order"
        required: true
        tool:
          connectorSlug: "acme_store"
          toolSlug: "get_order"
```

**Template fork** (fork from a global SOP template):
```yaml
sops:
  - name: "Order Lookup"
    templateSlug: "order-lookup"   # must match a template — see references/catalog.md
    status: active
    agents: ["acme-voice-agent"]
    connectorMapping:
      medusa: "acme_store"         # maps template's catalog refs to org's connector slugs
```

Cannot specify both `templateSlug` and `steps`.

### guardrails.yaml
```yaml
guardrails:
  - name: "No Medical Claims"
    slug: "no-medical-claims"
    content: |
      Never claim any product treats, cures, or prevents a medical condition.
    description: "FDA compliance"
    config: { priority: critical, category: compliance }
    agents: ["acme-voice-agent", "acme-chat-assistant"]
```

### evals.yaml

One file per agent. For multi-agent orgs, use multiple files: `evals-insurance.yaml`, `evals-booking.yaml`, etc. The `mg setup` pipeline globs for `evals*.yaml`.

```yaml
agentSlug: acme-voice-agent

evaluators:
  - name: confirms-order-id
    criterion: Agent confirms the order ID back to the customer
    tags: [accuracy]                    # optional
  - name: does-not-fabricate
    criterion: Agent does NOT make up order details or tracking information
    tags: [compliance, accuracy]        # optional

test_cases:
  - id: order-lookup-happy-path-01
    sop_slug: order-lookup
    scenario_key: order_status          # optional
    tags: [order-lookup, happy-path]    # optional
    evaluators:                         # references by name
      - confirms-order-id
      - does-not-fabricate
    input:
      customer_message: Hi, I placed an order last week, number ACM-12345.
      conversation_history:
        - role: assistant
          content: Thanks for calling Acme Corp. How can I help you today?
```

Also supports standalone import via JSON (`eval-scenarios.json`) with `--agent` flag:
```bash
bun run src/cli/mg.ts import-evals --org acme --agent acme-voice-agent /path/to/eval-scenarios.json
```

### sessions.yaml
```yaml
sessions:
  - agentSlug: "acme-voice-agent"
    channel: voice              # voice | web | api | slack | widget | sms | whatsapp | email
    status: completed           # active | completed | abandoned (default: completed)
    userIdentifier: "sarah@example.com"
    hoursAgo: 2                 # how far back to timestamp messages (default: 1)
    messages:
      - role: user
        content: "Hi, I want to check on my order ORD-1234."
      - role: assistant
        content: "Let me look that up for you."
    feedback:                   # optional
      verdict: good             # good | bad
      comment: "Very helpful"
      source: customer          # customer | support | system
    links:                      # optional
      - url: "https://store.acme.com/orders/1234"
        title: "Order ORD-1234"
        resourceType: "order"
```

## How to Prepare Files for a New Organization

When the user describes their organization, follow this process:

1. **Gather requirements:** What connectors do they need? What agents? What workflows (SOPs)?
2. **Create the directory:** anywhere the user wants (e.g., `~/onboarding/my-customer/`)
3. **Write files in dependency order:** org → users → secrets → connectors → agents → sops → guardrails → evals → sessions
4. **Validate with dry-run:** `cd modelguide-api && bun run src/cli/mg.ts setup /path/to/dir --dry-run`
5. **Run the import:** add `--skip-secrets` for testing, or run without flags for production

For the full schema reference with every field, type, and constraint, read `references/schemas.md`.
For available connector catalog entries and SOP templates, read `references/catalog.md`.
For a complete working example (Acme Corp), read `references/examples.md`.

## Running the CLI

All commands must be run from the `modelguide-api/` directory:

```bash
cd modelguide-api
bun run src/cli/mg.ts <command> [options]
```

**Running against Railway** (from your local machine):

```bash
cd modelguide-api
railway run --service api -- sh -c \
  'DATABASE_URL=postgresql://modelguide_app:$APP_DB_PASSWORD@$POSTGRES_TCP_PROXY_DOMAIN:$POSTGRES_TCP_PROXY_PORT/$PGDATABASE \
   bun run src/cli/mg.ts setup /path/to/my-org/ --skip-secrets'
```

`railway run` injects all env vars (secrets, encryption keys, etc.). `DATABASE_URL` is overridden with the public TCP proxy since the private hostname isn't reachable locally. Requires TCP proxy vars from `railway/DEPLOY.md` step 6.

## Common Patterns

**Add a single agent to an existing org:**
```bash
bun run src/cli/mg.ts add-agents --org acme name="New Agent" slug=new-agent modality=voice
```

**Compile only one agent:**
```bash
bun run src/cli/mg.ts compile-agents --org acme --agent acme-voice-agent
```

**Import SOPs without activating (review first):**
Set `status: draft` in sops.yaml, import, review in dashboard, then activate manually.

**Re-run after fixing a YAML error:**
Safe to re-run — duplicates are skipped. Only new entities get created.
