# ADR-013: Mocked Connectors and Tool Mock Strategy Across Eval, Simulation, and Dry-Run

**Status:** Accepted

## Context

ModelGuide supports demo deployments where there is no real backend service to call (e.g., Bank Nowa — a fictional bank used for sales demos). Three approaches have accumulated over time:

1. **TypeScript catalog modules** with hardcoded fixture handlers (e.g., `catalog/bank-nowa/`). All mock logic lives in code — adding or changing fixture data requires a deploy.
2. **Eval-level `mock_tool_responses`** in YAML eval suites — per-scenario, deterministic, used by the simulation runner to intercept tool calls before they reach the connector.
3. **No standard for dry-run production calls** — the agent makes real MCP calls during demos, which either hit real backends (risky) or fail (broken demo).

Additionally, three distinct contexts require tool mocks with different properties:

| Context | Who drives it | Tool response needs |
|---|---|---|
| **Eval** | Offline scorer / CI | Deterministic, evaluator-coupled, per-scenario |
| **Simulation** | Simulation runner (persona LLM + agent LLM) | Contextually coherent with the conversation |
| **Dry run** | Real agent, real voice call, no real backend | Stable, plausible, no external API dependency |

These contexts are not interchangeable. A single mock strategy cannot serve all three.

## Decision

### 1. DB-Driven Mock Responses for Connectors

Add `mock_response jsonb` (nullable) to `connector_tools`. When `mock_response IS NOT NULL`, the tool is a DB-driven mock — no TypeScript handler is needed.

The signal is the field itself. No separate `is_mocked` flag. `mock_response IS NULL` → real connector. `mock_response IS NOT NULL` → mock.

### 2. `executeTool()` Falls Back to DB When No Manifest Is Registered

The execution path in `mcp.service.ts executeTool()` gains a fallback:

```ts
const manifest = getConnectorManifest(catalogSlug);

if (!manifest) {
  const mockResponse = await getMockedToolResponse(orgId, connectorId, catalogToolName);
  if (mockResponse) {
    return { success: true, data: mockResponse };
  }
  throw Errors.connectorNotFound(catalogSlug);
}
// real path unchanged
```

Real connectors always have a registered TypeScript manifest — the fast path is unchanged. Demo connectors without a manifest fall through to the DB lookup. This is the only change to the execution path.

Input schema validation still runs for mocked tools (the LLM receives the real schema and must call it correctly). Only execution is intercepted.

### 3. Catalog Entry Stays; TypeScript Module Is Removed

The `connectors_catalog` FK on `connectors` remains NOT NULL. Removing it would require changing seven join sites across the codebase. Instead, mocked connectors have a real catalog entry in the DB — seeded via CLI, not from a TypeScript module.

This means `catalog/bank-nowa/` can be deleted. The catalog entry it was creating is now created by:

```bash
mg add-connectors --org bank-nowa --from bank-nowa.yaml
```

Each connector in the YAML that has `isMocked: true`:
- Upserts a `connectors_catalog` row for the slug (creates if absent; `iconUrl` is write-once — first seeder wins)
- Creates the `connectors` instance
- Creates `connector_tools` rows with `mock_response` populated from the YAML
- On re-run, reconciles `mock_response`, `tool_schema`, and `description` for existing tool rows (edits in YAML flow through without a delete-then-reimport)

The YAML format for a mocked connector includes inline tool definitions:

```yaml
connectors:
  - name: "Bank Nowa Banking"
    slug: banknowa_banking
    isMocked: true
    iconUrl: /logos/bank-nowa.svg   # optional — rendered in the UI catalog
    tools:
      - name: verify_customer
        input_schema: { ... }
        mock_response:
          success: true
          card_id: "CARD-001"
          customer_name: "Artur Nowak"
```

Real connectors continue to reference `catalogSlug` and resolve tools from the registered TypeScript manifest. The YAML schema is a union — real connectors have `catalogSlug + secrets`, mocked connectors have `isMocked: true + tools[].mock_response`.

### 4. Mock Strategy by Context

#### Eval — Deterministic, Evaluator-Coupled

Eval scenarios define `mock_tool_responses` per scenario in their YAML. These are intercepted by the simulation runner before the MCP layer is reached. They are never stored in the DB.

**Why:** Evaluators check specific values (e.g., "agent said 450 PLN") — the mock response must produce exactly those values. Catalog-level defaults cannot be evaluator-coupled. Eval mocks are test artifacts, not connector configuration.

**Rule:** Eval mock responses must be the minimum data needed to satisfy the evaluators in that scenario. Do not add fields the evaluator doesn't check.

#### Simulation — Contextually Coherent

A simulation is a full open-ended run: a persona LLM plays the customer and an agent LLM plays the agent, with no scripted outcome. Tool responses must be internally consistent with the conversation.

Mocking strategy is per-tool-category:

| Tool category | Mock strategy | Rationale |
|---|---|---|
| Identity / blocking (verify_customer, block_card, create_dispute, order_new_card) | Static catalog default | Output is acknowledgment, not content-driven. Persona adapts to any plausible success response. |
| Query tools (lookup_transaction, check_standing_orders) | LLM-generated | Content is read back to the customer and the persona must react to it. Static defaults break coherence when the persona's claimed amount differs from the returned transaction. |

LLM-generated mock responses are produced by the simulation runner, not by the agent. The runner injects a short system prompt with the tool schema and conversation history: "Generate a realistic response for this tool call, consistent with what the customer described." The generated response is used for this turn only — not stored.

This is a simulation runner concern and does not affect `connector_tools.mock_response` or `executeTool()`.

#### Dry Run — Stable, Plausible, No External Dependency

A dry-run call is a real voice call (real LiveKit session, real STT/LLM/TTS pipeline, real MCP call) where the connector backend is mocked. Used for demos, QA, and onboarding without requiring production banking APIs.

Dry-run tool calls follow the same execution path as production calls. The `executeTool()` fallback serves `mock_response` from the DB. No special mode, no flag — the absence of a TypeScript manifest is the signal.

**Why not use eval mocks for dry runs:** Eval mocks are scenario-specific and require the simulation runner as a proxy. A dry-run call goes through the real agent → real MCP endpoint → real `executeTool()`. The DB fallback is the only mechanism that works at this layer.

**Consistency:** All concurrent dry-run calls for the same connector see the same `mock_response` values. This is intentional — dry runs are demos, not unit tests. Determinism prevents "sometimes works, sometimes doesn't" demo failures.

### 5. No Changes to Simulation Runner for Dry-Run Handling

The simulation runner and the production MCP handler share no code. The simulation runner intercepts at the `mock_tool_responses` YAML level, well before `executeTool()`. The `executeTool()` DB fallback is only reached by production calls. These are independent code paths.

## Alternatives Considered

**`is_mocked` boolean flag on `connectors` or `connectors_catalog`** — rejected. `mock_response IS NOT NULL` is sufficient. An explicit flag alongside a nullable `mock_response` creates two sources of truth that can disagree. One field, one check.

**Nullable `connector_catalog_id` on `connectors`** — rejected. Seven callsites JOIN on this column (INNER JOIN in `listAgentConnectors`, manual catalog lookups in `getAgentTools`, `resolveConnectorConfigById`, etc.). Making it nullable requires guarding all seven. Keeping the catalog entry in DB and removing only the TypeScript module achieves the same goal with zero JOIN changes.

**LLM-generated mocks for all simulation tools** — rejected. LLM generation adds latency and non-determinism to tools where it adds no value. `verify_customer` returning `{success: true, card_id: "CARD-001"}` is always coherent regardless of conversation content. Reserve generation for tools whose response content is read back to the customer.

**Static mocks for all simulation tools** — rejected. `lookup_transaction` returning a fixed merchant breaks coherence when the persona claims "I saw a 450 PLN charge" and the mock returns 85.50 PLN for Żabka. The persona LLM has to either ignore or reconcile the discrepancy, producing unnatural simulations.

**Separate `import-connectors` CLI command** — rejected in favour of extending `add-connectors --mock`. The existing command already handles org resolution, idempotency, and registry integration. Adding `--mock` is ~40 lines. A new command would duplicate all of that.

## Consequences

- `catalog/bank-nowa/` (and equivalent future demo connector directories) can be deleted. Demo connector configuration lives entirely in YAML + DB.
- Adding a new mock response or changing an existing one is a YAML change + CLI re-seed — no code deploy required.
- Real connector execution is unchanged. The `manifest` check in `executeTool()` is a fast in-memory map lookup; the DB fallback is only reached when the map misses.
- Simulation runner owns LLM-generated mock responses for query tools. These are ephemeral — not stored, not reused across turns.
- Dry-run calls require no mode flag on the client side. The caller dispatches normally; the absence of a backend is transparent.
- Eval mock responses remain in YAML, tightly coupled to their evaluators. They are not promoted to DB — doing so would decouple mock data from the evaluators that depend on it, creating silent mismatches when evaluators are updated.
- The three mock contexts (eval, simulation, dry-run) are served by three independent mechanisms. They do not share state and do not interfere with each other.
