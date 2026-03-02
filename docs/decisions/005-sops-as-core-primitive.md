# ADR-005: SOPs as Core Primitive

**Status:** Accepted

## Context

ModelGuide records agent sessions but has no structured way to define expected agent behavior. Customer-facing teams create SOPs (Standard Operating Procedures) informally; there's no machine-readable format to verify whether sessions follow the golden path. References issue #103 and the existing connector architecture (ADR-004).

SOPs serve three purposes:
1. **Agent behavioral contract** — source of truth for agent behavior, consumed as prompts/guardrails/knowledge
2. **Post-session evaluation anchor** — match SOPs against session transcripts, verify each step (separate deliverable)
3. **Fast project onboarding** — combined with simulation to validate agents before production (separate deliverable)

## Decision

### Two-tier model mirroring connectors

Global `sop_templates` (catalog) fork into org-scoped `sops` (instances), following the `connectors_catalog → connectors` pattern from ADR-004. Templates are reusable blueprints tied to connector catalog types. Definitions are org-specific and optionally scoped to agents.

### Steps are actions, not evaluators

Each step is an instruction with an optional tool reference. Steps define what the agent should do (the golden path), not how to evaluate compliance. The eval engine (separate deliverable) determines pass/fail.

### Step-level connector binding

Each step's tool reference is a single `connectorToolId` FK to `connector_tools.id`. The full MCP tool name (`resolvedName`) is computed at read time by joining `sop_steps → connector_tools → connectors`, giving proper relational integrity. Templates use `catalogSlug + toolSlug` for portability; these are resolved to `connectorToolId` on fork. A single SOP can have steps referencing different connector tools (e.g., Medusa for order lookup, Zendesk for ticket creation).

### Multi-agent assignment

Many-to-many via `agent_sops` junction table, following the `agent_connector_tools` pattern.

### Storage layout differs by table

The three SOP-related tables store `SopSchema` data differently:

| Table | Storage | Rationale |
|---|---|---|
| `sop_templates` | Single `definition` JSONB column (full `SopSchema`) | Self-contained catalog blueprints. No need to split. |
| `sops` | `trigger` JSONB + `metadata` JSONB columns, steps in `sop_steps` table | Steps are relational for indexing, validation, and independent updates. Trigger and metadata are explicit columns — no misleading partial-object `definition`. `schemaVersion` is injected at read time (always `1`). |
| `sop_versions` | Single `definition` JSONB column (full `SopSchema`) | Frozen immutable snapshots. Single blob is simpler for audit records. |

The API contract is unchanged: clients always send/receive `{ schemaVersion, trigger, steps, metadata }`. The service assembles this from the appropriate storage on read and splits on write.

```
                        ┌─────────────────────────────┐
                        │       API response           │
                        │  { schemaVersion, trigger,   │
                        │    steps, metadata }         │
                        └──────────────┬──────────────┘
                                       │ assembled by service
                       ┌───────────────┼───────────────┐
                       ▼               ▼               ▼
              ┌────────────┐   ┌─────────────┐   ┌──────────┐
              │    sops    │   │  sop_steps   │   │sop_versions│
              │ (RLS)      │   │ (relational) │   │ (audit)    │
              ├────────────┤   ├─────────────┤   ├──────────┤
              │ trigger    │   │ step_id      │   │ definition │
              │ metadata   │   │ instruction  │   │ (full blob)│
              │            │   │ tool refs    │   │            │
              └────────────┘   └─────────────┘   └──────────┘

              ┌────────────────┐
              │ sop_templates  │
              │ (global)       │
              ├────────────────┤       fork
              │ definition     │ ─────────────► sops + sop_steps
              │ (full blob)    │
              └────────────────┘
```

`SopSchema` is validated by Zod on write. Discriminated union triggers (channel, intent_detected, tool_present, manual).

### Binary pass/fail scoring

All required steps must pass for the SOP to pass. No weights or thresholds. This is an eval engine concern, not stored in the SOP schema.

### Inactive tool warnings at read time

When a step references a tool or connector that has become inactive, the API enriches the response with warnings. The JSONB is not modified — warnings are computed by joining against `connector_tools.isActive` and `connectors.isActive`.

## Alternatives Considered

- **Single-tier (no templates)** — rejected: templates enable reusable blueprints across orgs, mirroring the connector catalog pattern that works well.
- **SOP-level connector binding** — rejected: individual steps can reference different connectors.
- **Evaluator configs in steps** — rejected: keeps SOP authoring simple for domain experts; eval complexity lives in the eval engine.
- **Weighted scoring** — rejected: binary pass/fail is simpler and sufficient for the authoring phase.
- **`onFail` in SOP schema** — deferred to eval engine deliverable; it's an eval-time concern.

## Consequences

- SOPs become the behavioral contract between orgs and agents, complementing the existing connector/tool infrastructure.
- Step-level tool references create a loose coupling to connectors — if a connector is deleted/deactivated, SOPs warn but don't break.
- Template-to-definition fork pattern enables cross-org reuse while respecting tenant isolation via RLS.
