# ADR-004: Connector Tool Startup Sync

**Status:** Accepted

## Context

### Data model

ModelGuide's connector system has three database layers:

1. **`connectors_catalog`** — Global registry of connector types. Each row represents a connector definition (Medusa, Zendesk) with its `configSchema` and a `tools` JSONB array of `CatalogTool` objects (name, description, inputSchema, defaults). No RLS — shared across all orgs. Keyed by `slug`.

2. **`connector_tools`** — Org-scoped instances of individual tools, created when an organization adds a connector. Each row references a `connectorId` and carries tool metadata (`name`, `slug`, `toolSchema`, `timeoutSeconds`, `isActive`). RLS-protected with a unique constraint on `(connectorId, slug)`. Slug is derived from the catalog tool name: `name.toLowerCase().replace(/\s+/g, "_")`.

3. **`agent_connector_tools`** — Junction table linking agents to specific `connector_tools`. Stores per-agent overrides: `isEnabled` and `requiresConfirmation` (overriding the catalog's `defaultRequiresConfirmation`). No RLS — security is inherited by always joining through RLS-protected parents. Unique on `(agentId, connectorToolId)`.

### The flow today

- **Manifest → catalog:** The `sync.ts` CLI upserts connector manifests (from code) into `connectors_catalog`.
- **Catalog → tools:** When an org creates a connector via `createConnector()`, all `CatalogTool` entries are bulk-inserted as `connector_tools` rows.
- **Tools → agents:** Agent-to-tool assignments are created explicitly (via the dashboard or seed script).

### The gap

When a new tool is added to a connector manifest (e.g., `look_up_order_history` added to Medusa), running `sync.ts` updates the catalog's `tools` JSONB. However, **existing `connector_tools` rows and `agent_connector_tools` assignments are never backfilled**. New tools only appear when a connector is freshly created. Deploying a new tool to production would require re-seeding — not viable with real customer data.

## Decision

Run an idempotent sync at API startup that propagates new tools from manifests through the full chain:

**manifests → `connectors_catalog` → `connector_tools` → `agent_connector_tools`**

The sync (`syncCatalogAndTools()`) executes after `loadAllManifests()` and before `Bun.serve()`:

1. **Catalog sync** — Upsert manifests into `connectors_catalog` (same as the `sync.ts` CLI, now shared).
2. **Tool sync** — Using `forApp()` to bypass RLS for cross-org operation:
   - Load all active connectors joined with their catalog slug.
   - Diff manifest tools against existing `connector_tools` per connector.
   - Batch-insert missing `connector_tools` rows (`ON CONFLICT DO NOTHING`).
   - For each affected connector, find agents that already use any tool from that connector and batch-insert `agent_connector_tools` for the new tools (`ON CONFLICT DO NOTHING`), with `requiresConfirmation` set from the catalog default.

### Key invariants

- **Insert-only** — Never updates existing rows. Org-specific customizations (`isActive`, `timeoutSeconds`, `requiresConfirmation` overrides) are preserved.
- **Idempotent** — Safe to run on every startup. `ON CONFLICT DO NOTHING` prevents duplicates.
- **Cross-org** — Uses `forApp()` (RLS bypass) since the sync operates across all organizations.

### Alternatives considered

- **Per-tool DB migrations** — Fragile with multi-tenant RLS-scoped tables. Each new tool would require a migration that queries across orgs, making rollbacks risky.
- **Admin API endpoint** — Manual trigger is easy to forget and adds operational burden.
- **Background job / cron** — Adds infrastructure complexity for something that only needs to happen at deploy time.

Startup sync is the simplest approach: it runs exactly when new code is deployed, requires no manual intervention, and the INSERT-only pattern makes it safe.

## Consequences

- New connector tools are automatically available to existing connectors and agents after deployment.
- Startup time increases slightly (one cross-org query + conditional batch inserts). Expected to be < 100ms for typical deployments.
- The `sync.ts` CLI is simplified to call the shared `syncCatalogAndTools()` function.
- Tool removal is intentionally **not** handled — deactivating tools requires explicit admin action to avoid breaking running agents.
