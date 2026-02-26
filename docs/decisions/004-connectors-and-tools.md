# ADR-004: Connectors and Tools

**Status:** Accepted

## Context

### Connectors and tools

Connectors are the integration layer between AI agents and external services (e-commerce, helpdesk, calendars). Each connector is defined in code as a TypeScript module exporting a `ConnectorManifest` — a declarative description of the service it integrates with, including metadata, configuration schema, and an array of tools.

Each tool has two parts: a `catalog` object (name, description, JSON Schema input, defaults for timeout and confirmation) that gets stored in the database, and a `handler` function that executes at runtime. Tools are namespaced per connector instance — the same Medusa connector used by two orgs produces tool names like `glowbox_store_add_to_cart` and `clearhealth_pharmacy_add_to_cart`.

Adding a connector is a single file. Run `make sync-connectors` and the manifest is available for orgs to configure through the dashboard.

### Data model

The connector system spans three database layers:

1. **`connectors_catalog`** — Global registry of connector types (e.g., Medusa, Zendesk). Each row stores a manifest's metadata and a `tools` JSONB array of `CatalogTool` objects. No RLS — shared across all orgs. Keyed by unique `slug`.

2. **`connector_tools`** — Org-scoped tool instances, created when an organization adds a connector. Each row references a `connectorId` and carries tool metadata (`name`, `slug`, `toolSchema`, `timeoutSeconds`, `isActive`). RLS-protected, unique on `(connectorId, slug)`. Slug derived from tool name: `name.toLowerCase().replace(/\s+/g, "_")`.

3. **`agent_connector_tools`** — Junction table linking agents to individual tools. Stores per-agent overrides (`isEnabled`, `requiresConfirmation`). Security inherited from RLS-protected parents. Unique on `(agentId, connectorToolId)`.

### Lifecycle

- **Code → catalog:** Manifests are loaded into an in-memory registry at startup (`loadAllManifests()`). The `sync.ts` CLI upserts them into `connectors_catalog`.
- **Catalog → connector tools:** When an admin creates a connector instance via the dashboard, `createConnector()` bulk-inserts one `connector_tools` row per `CatalogTool` from the catalog.
- **Tools → agents:** Agent-to-tool assignments are managed through the dashboard or seed scripts, creating `agent_connector_tools` rows.

### The gap

When a new tool is added to a manifest (e.g., `look_up_order_history` added to the Medusa connector), running `sync.ts` updates the catalog's `tools` JSONB. However, existing `connector_tools` rows and `agent_connector_tools` assignments are never backfilled. New tools only appear when a connector is freshly created. Deploying a new tool to production would require re-seeding — not viable with real customer data.

## Decision

Run an idempotent sync at API startup that propagates new tools from manifests through the full chain:

**manifests → `connectors_catalog` → `connector_tools` → `agent_connector_tools`**

The sync (`syncCatalogAndTools()`) executes after `loadAllManifests()` and before `Bun.serve()`:

1. **Catalog sync** — Upsert manifests into `connectors_catalog` (same logic as the `sync.ts` CLI, now shared).
2. **Tool sync** — Using `forApp()` to bypass RLS for cross-org operation:
   - Load all active connectors joined with their catalog slug.
   - Diff manifest tools against existing `connector_tools` per connector.
   - Batch-insert missing `connector_tools` rows (`ON CONFLICT DO NOTHING`).
   - For each affected connector, find agents that already use any tool from that connector and batch-insert `agent_connector_tools` for the new tools (`ON CONFLICT DO NOTHING`), with `requiresConfirmation` set from the catalog default.

### Key invariants

- **Full lifecycle** — Inserts new tools, updates stale schema/description, soft-deletes removed tools. Org-specific customizations (`isActive`, `timeoutSeconds`, `requiresConfirmation` overrides) are never modified by sync.
- **Idempotent** — Safe to run on every startup. `ON CONFLICT DO NOTHING` prevents duplicates; sorted-keys JSON comparison prevents false-positive updates.
- **Cross-org** — Uses `forApp()` (RLS bypass) since the sync operates across all organizations.

### Alternatives considered

- **Per-tool DB migrations** — Fragile with multi-tenant RLS-scoped tables. Each new tool would require a migration that queries across orgs, making rollbacks risky.
- **Admin API endpoint** — Manual trigger is easy to forget and adds operational burden.
- **Background job / cron** — Adds infrastructure complexity for something that only needs to happen at deploy time.

Startup sync is the simplest approach: it runs exactly when new code is deployed, requires no manual intervention, and the INSERT-only pattern makes it safe.

### Soft delete and tool removal

When a tool is removed from a connector manifest, the sync sets `deleted_at` on the corresponding `connector_tools` rows rather than hard-deleting them. This preserves audit history (the row remains queryable with explicit `WHERE deleted_at IS NOT NULL`) while hiding removed tools from all live queries.

**Schema:** `connector_tools.deleted_at` (nullable `timestamptz`). A partial unique index `(connector_id, slug) WHERE deleted_at IS NULL` ensures only live tools enforce the slug uniqueness constraint. Soft-deleted rows don't conflict, so re-adding a tool that was previously removed inserts a fresh row with a new UUID.

**Orphaned agent assignments:** Since soft delete doesn't trigger `ON DELETE CASCADE`, the sync explicitly hard-deletes `agent_connector_tools` rows pointing to newly soft-deleted tools within the same transaction. These assignments are meaningless once the handler no longer exists.

**Schema drift detection:** Manifest changes to `inputSchema` or `description` are detected by comparing a deterministic sorted-keys JSON serialization (`stableStringify`) against the stored JSONB. This prevents false-positive updates when Postgres JSONB reorders object keys on storage/retrieval. Only `toolSchema` and `description` are updated — `isActive`, `timeoutSeconds`, and other org-specific overrides are preserved.

### Scalability

The sync runs inside a single `forApp()` transaction. Inserts, soft-deletes, and catalog upserts use batch or parallel operations. Schema-drift updates are dispatched concurrently via `Promise.all` (each stale tool gets its own `UPDATE … WHERE id = ?` fired in parallel within the transaction). This is acceptable at current scale — a handful of connectors × ~10 tools each means at most ~100 concurrent updates on a deployment where every schema changes simultaneously (unlikely in practice).

If the platform grows to hundreds of organizations with many connectors, the single-transaction scope may cause noticeable lock duration at startup. At that point, consider:

- **Batched updates** — consolidate concurrent per-row updates into a single `UPDATE FROM (VALUES …)` statement.
- **Per-connector chunking** — split the transaction per connector to reduce lock contention.
- **Deferred sync** — move sync to a post-startup background job so the server can begin serving requests immediately.

## Consequences

- New connector tools are automatically available to existing connectors and agents after deployment.
- Stale tool schemas and descriptions are corrected on every deployment without manual intervention.
- Removed tools are soft-deleted, preserving audit history while preventing agents from seeing tools with no handler.
- Startup time increases slightly (one cross-org query + conditional batch operations). Expected to be < 100ms for typical deployments.
- The `sync.ts` CLI is simplified to call the shared `syncCatalogAndTools()` function.
