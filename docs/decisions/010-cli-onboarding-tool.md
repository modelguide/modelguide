# ADR-010: CLI Onboarding Tool

**Status:** Accepted

## Context

Setting up a new ModelGuide org for customer onboarding required editing TypeScript seed scripts or manual API/dashboard work. Each new customer needed ad-hoc scripting — creating the org, users, connectors with secrets, agents with tool assignments, SOPs, guardrails, and demo sessions. This was error-prone, not repeatable, and blocked non-engineers from provisioning.

Requirements:
- Scriptable, repeatable org provisioning
- YAML-driven for complex entities (SOPs, sessions, guardrails)
- CLI args for simple entities (users, secrets)
- Full pipeline orchestrator with dependency ordering
- Idempotent — safe to re-run without duplicates or orphaned resources
- No duplicated business logic — delegate to existing service layer

## Decision

### Thin CLI over existing services

The CLI (`mg`) is a thin orchestration layer using Commander.js. All business logic is delegated to the existing service layer — the CLI handles parsing, validation, and output only. This avoids duplicating validation, RLS context, encryption, and other concerns already handled by services.

```
YAML / CLI args → Zod validation → Service calls → DB (via RLS)
```

### Commands

| Command | Input | Service |
|---------|-------|---------|
| `create-org` | `--name --slug [--from]` | Direct DB via `forApp()` |
| `add-users` | `"email=...,role=..." [--from]` | `users.service.createUser` |
| `add-secrets` | `"name=...,value=...,type=..." [--from]` | `secrets.service.createSecret` |
| `add-connectors` | `--from <file>` | `connectors.service.createConnector` |
| `add-agents` | `"name=...,modality=..." [--from]` | `agents.service.createAgent` |
| `import-sops` | `<file>` | `sops.service.createSop` / `forkFromTemplate` |
| `import-guardrails` | `<file>` | `knowledge-base.service.createKnowledgeBase` |
| `import-sessions` | `<file>` | `sessions.service.createSession` / `addMessages` |
| `compile-agents` | `--org [--agent]` | `compiler.service.compileAgent` |
| `setup` | `<dir> [--dry-run]` | All of the above in dependency order |

### Setup orchestrator

`mg setup <dir>` loads all YAML files from a directory and executes them in dependency order:

```
org → users → secrets → connectors → agents → SOPs → guardrails → compile → sessions
```

An `IdRegistry` threads entity IDs (slug → UUID) across steps so later steps can reference earlier ones by slug.

### Idempotency

Commands that create uniquely keyed resources catch duplicate/already-exists errors and count them as `existing` rather than failing. Session imports dedupe on `externalId`; when omitted, the CLI derives a deterministic fingerprint from the YAML entry so re-importing the same payload is safe.

Connector creation checks existence before creating secrets to avoid orphaned secret rows on re-run.
Standalone `add-secrets` is intentionally append-only because secrets do not currently have a stable natural key in the data model.
Agent re-runs detect the duplicate and skip tool assignment — updating an existing agent's connector tool links requires the dashboard or API. This is acceptable because tool assignment changes are typically deliberate configuration updates, not part of initial provisioning.

### YAML schema validation

Each YAML file is validated against a Zod schema before any DB operations. `mg setup --dry-run` validates all files and prints a plan without touching the database.

### RLS and DB access

The CLI loads the full `src/env.ts` (same as the API) and uses the same DB connection with RLS context. `resolveOrgId` uses `forApp()` to bypass RLS on the organizations table (which has RLS enabled). All other operations use org-scoped service calls.

## Alternatives Considered

**Admin API endpoints** — Would require auth tokens and HTTP transport for what's fundamentally a local provisioning task. CLI with direct service calls is simpler and faster.

**Seed scripts per customer** — The previous approach. Not maintainable — each customer fork diverges. YAML configs are declarative and diffable.

**Terraform/Pulumi provider** — Over-engineered for the current scale. Could be built later on top of the same service layer if needed.

## Consequences

- Customer onboarding is now a single command: `mg setup examples/acme/`
- YAML configs are version-controlled and reviewable
- New connectors/agents can be tested locally before deploying
- The CLI shares the same service layer as the API — no behavior drift
- Secret values are visible in shell history when passed as CLI args (acceptable for internal tooling; production secrets should use `--from` with restricted file permissions)
- The `mg.ts` entry point closes the DB connection pool after command completion so the process exits cleanly — individual commands don't need to handle this
