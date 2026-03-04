# PRD: Evaluation Engine

## Phase 1 — SOP Compliance Evaluation

**Issue #103 · v1.0**
*Architecture: Owned runtime + storage · Eval configs as shared entity · Reporter interface for external platforms*

---

## 1. Overview

The evaluation engine verifies whether an AI agent followed a defined SOP during a customer session. It analyzes real session transcripts post-hoc — the agent has already run, the tools have already been called, the customer has already interacted. The engine forensically determines: did the agent do what the SOP says it should?

Key design principles:

- **Binary scoring** — pass/fail per step, pass/fail per run. All required scores pass = run passes.
- **Error taxonomy** — failed scores get a `failureClassification` explaining why, enabling actionable remediation.
- **LLM judge honesty** — ships uncalibrated in v1 with clear labeling. Calibration workflow (human labels, agreement metrics) is v2.
- **Self-contained** — evals run with zero external dependencies. External platforms (Langfuse, Braintrust) are optional reporters for analytics.

### 1a. Architecture overview

| Layer | Owner | What lives here |
|---|---|---|
| Eval configs + evaluators | **ModelGuide** | `eval_configs` table, evaluator pure functions, `StepEvaluatorConfig` types |
| Compilation + execution | **ModelGuide** | `compileSopToEvalPlan()`, eval runner service |
| Storage + API | **ModelGuide** | `eval_runs` + `eval_run_scores` tables, API routes (trigger, list, get) |
| Analytics + visualization | **External (optional)** | Reporter interface — Langfuse, Braintrust, or console. Fire-and-forget after local storage. |

### 1b. Sequencing roadmap

This PRD covers **Step 2**. The full eval maturity path:

| Step | What | Dependency | Scope |
|---|---|---|---|
| **1** | **OTel tracing pipeline → Langfuse** — every session streams traces (messages, tool calls, outputs) for observability. Langfuse becomes the single pane for "what did the agent do." | Separate PRD | Out of scope |
| **2** | **Local eval execution** — eval_configs, 4 evaluators, compilation, runner, owned storage, API routes. Works on localhost with zero external services. | None | **This PRD** |
| **3** | **Score emission to Langfuse** — after local execution, `LangfuseReporter` pushes scores to the trace already in Langfuse (from Step 1). Dashboards, failure trends, experiment comparison — for free. | Steps 1 + 2 | Future |
| **4** | **Langfuse-delegated execution** — Langfuse datasets trigger experiment runs via webhook. ModelGuide compiles + executes, scores flow back. Langfuse orchestrates, ModelGuide scores. | Step 3 | Future |
| **5** | **Langfuse-native execution** — translate eval_configs into Langfuse's evaluator format. Langfuse runs everything against traces it already has. Full offload. | Step 4 | Future (may never be needed) |

Steps 1 and 2 are independent parallel tracks. They converge at Step 3.

---

## 2. Eval Configs — Shared Entity

Eval configs are reusable evaluator definitions shared across SOPs and guardrails. They answer: "how should this kind of step be evaluated?"

SOP steps reference an eval config by ID. Steps without an `eval_config_id` are not evaluated — they are skipped with a coverage warning in the run metadata.

### 2a. Database schema

```sql
CREATE TYPE evaluator_type AS ENUM (
  'tool_called',
  'tool_input_contains',
  'no_tool_called',
  'llm_judge'
);

CREATE TABLE eval_configs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           UUID NOT NULL REFERENCES organizations(id),
  name             VARCHAR(255) NOT NULL,
  description      TEXT,
  evaluator_type   evaluator_type NOT NULL,
  config           JSONB NOT NULL,            -- type-specific params only (no type key inside)
  created_by       UUID REFERENCES users(id),
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now()
);
```

`evaluator_type` is a top-level column, not nested in `config`. It determines which evaluator function runs — that's structural, not configuration. The `config` JSONB holds only the parameters for that type. DB-level enum validates on insert. Future evaluator types added via `ALTER TYPE evaluator_type ADD VALUE`.

**RLS:** `eval_configs` is org-scoped. Enable RLS and query via `forOrg()`, same as connectors/secrets/SOPs.

### 2b. SOP step binding

The `sop_steps` table gains one new nullable column:

| Column | Type | Notes |
|---|---|---|
| `eval_config_id` | `UUID` | FK to `eval_configs`. Nullable. Steps without an eval config are skipped during evaluation. |

### 2c. Eval config examples

| Config name | evaluator_type | config |
|---|---|---|
| `refund_tool_check` | `tool_input_contains` | `{ "connectorToolId": "<UUID>", "assertions": { "amount": { "op": "gt", "value": 0 }, "reason": { "op": "exists" } } }` |
| `pii_not_leaked` | `llm_judge` | `{ "criterion": "Agent never revealed customer PII to a third party" }` |
| `blocked_tool_guard` | `no_tool_called` | `{ "connectorToolId": "<UUID>" }` |

---

## 3. Eval Results — Owned Storage

### 3a. eval_runs table

One row per evaluation of a session against a source:

```sql
CREATE TABLE eval_runs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES organizations(id),
  session_id      UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  source_type     eval_source_type NOT NULL,    -- 'sop' for now
  source_id       UUID NOT NULL,                -- references sop.id (generic pointer, not FK)
  status          eval_status NOT NULL,          -- 'pending', 'running', 'completed', 'failed'
  passed          BOOLEAN,                       -- nullable until completed. all required scores pass = true
  duration_ms     INTEGER,                       -- wall-clock eval time
  triggered_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  external_run_id  VARCHAR(255),                 -- reporter back-link (Langfuse trace ID, etc.)
  external_run_url VARCHAR(500),                 -- reporter back-link URL
  metadata        JSONB,                         -- coverage warnings, extensible
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  completed_at    TIMESTAMPTZ
);

-- Prevent duplicate active evals for same session+source
CREATE UNIQUE INDEX idx_eval_runs_active
  ON eval_runs(session_id, source_type, source_id)
  WHERE status IN ('pending', 'running');

CREATE INDEX idx_eval_runs_session ON eval_runs(session_id);
CREATE INDEX idx_eval_runs_source ON eval_runs(source_type, source_id);
CREATE INDEX idx_eval_runs_created ON eval_runs(created_at);
```

**RLS:** `eval_runs` has `org_id` and uses `forOrg()` for all queries. This is consistent with other org-scoped tables and avoids relying solely on the sessions FK join for access control.

**Immutability:** Eval runs are append-only audit records. No `DELETE` API route is provided. See ADR-007 for rationale.

### 3b. eval_run_scores table

One row per score in an evaluation run. Source-agnostic — works for SOP steps, guardrail rules, FAQ criteria.

```sql
CREATE TABLE eval_run_scores (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  eval_run_id             UUID NOT NULL REFERENCES eval_runs(id) ON DELETE CASCADE,
  org_id                  UUID NOT NULL REFERENCES organizations(id),
  eval_config_id          UUID NOT NULL REFERENCES eval_configs(id),
  name                    VARCHAR(255) NOT NULL,    -- human-readable: 'step:1:Verify customer identity'
  score_order             INTEGER NOT NULL,
  required                BOOLEAN NOT NULL,          -- whether this score affects the run verdict
  evaluator_type          evaluator_type NOT NULL,
  result                  eval_score_result NOT NULL,   -- 'pass', 'fail', 'skip', 'error'
  reasoning               TEXT NOT NULL,                -- mandatory, substantive
  failure_classification  VARCHAR(50),                  -- set on fail
  expected                JSONB,                        -- what evaluator expected
  actual                  JSONB,                        -- what was observed
  duration_ms             INTEGER,
  created_at              TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_eval_run_scores_run ON eval_run_scores(eval_run_id);
CREATE INDEX idx_eval_run_scores_config ON eval_run_scores(eval_config_id);
```

**RLS:** `eval_run_scores` has `org_id` and uses `forOrg()`. Consistent with `eval_runs`.

`eval_config_id` provides traceability — which config produced this score. Enables querying "show me all scores from this eval config" to measure config effectiveness.

`name` is human-readable and source-agnostic. Format: `step:{order}:{instruction_truncated}` for SOPs (e.g., `step:1:Verify customer identity`), `rule:{ruleId}` for guardrails. Truncate instruction to 60 characters. Matches Langfuse's score naming convention — when the `LangfuseReporter` ships (Step 3), `eval_run_scores` map directly to Langfuse scores on the session trace.

`required` captures whether this score contributes to the run verdict. Persisted at score creation time from the SOP step's `required` field, so the verdict is self-contained — no need to re-read the eval plan.

### 3c. Supporting enums

```sql
CREATE TYPE eval_source_type AS ENUM ('sop');
CREATE TYPE eval_status AS ENUM ('pending', 'running', 'completed', 'failed');
CREATE TYPE eval_score_result AS ENUM ('pass', 'fail', 'skip', 'error');
```

---

## 4. Type System

### 4a. StepEvaluatorConfig

Discriminated union of v1 evaluator types. All tool references use `connectorToolId` — a UUID FK to `connector_tools`. The compilation layer resolves these to runtime tool names at eval time.

```typescript
type StepEvaluatorConfig =
  | { type: 'tool_called'; connectorToolId: string }
  | { type: 'tool_input_contains'; connectorToolId: string; assertions: Record<string, Assertion> }
  | { type: 'no_tool_called'; connectorToolId: string }
  | { type: 'llm_judge'; criterion: string; rubric?: { pass: string; fail: string }; model?: string }
```

> When stored in `eval_configs`, the `type` discriminant lives in the `evaluator_type` column. The `config` JSONB holds only the remaining fields (e.g. `{ "connectorToolId": "...", "assertions": {...} }` for `tool_input_contains`).

### 4b. Assertion

```typescript
type AssertionOp = 'equals' | 'contains' | 'gt' | 'lt' | 'exists' | 'matches';

type Assertion = { op: AssertionOp; value?: string | number | boolean }
```

**Safe regex for `matches`:** When `op` is `matches`, the `value` string is validated before use:
- Maximum length: 200 characters
- Disallowed patterns: nested quantifiers (`(a+)+`), excessive alternation, backreferences
- Execution timeout: 5ms per match via safe regex wrapper
- Invalid patterns return `error` result with reasoning, never throw

See `evaluators/assertions.ts` for the `safeRegexTest()` implementation.

### 4c. FailureClassification

```typescript
type FailureClassification =
  | 'tool_not_called'
  | 'wrong_arguments'
  | 'policy_violation'
  | 'criterion_not_met';
```

### 4d. EvalContext

```typescript
interface EvalContext {
  messages: SessionMessage[];
  toolMessages: SessionMessage[];           // role="tool" only
  resolvedToolNames: Map<string, string>;   // connectorToolId → resolved runtime tool name
}
```

### 4e. EvaluatorResult

```typescript
interface EvaluatorResult {
  result: 'pass' | 'fail' | 'skip' | 'error';
  reasoning: string;                         // mandatory, substantive
  failureClassification?: FailureClassification;
  expected?: Record<string, unknown>;
  actual?: Record<string, unknown>;
  durationMs?: number;
}
```

### 4f. Evaluator interface

```typescript
interface Evaluator {
  readonly type: string;
  evaluate(ctx: EvalContext, config: StepEvaluatorConfig): Promise<EvaluatorResult>;
}
```

---

## 5. Evaluator Implementations

All evaluators are pure functions: `(EvalContext, config) → EvaluatorResult`. No side effects, no network calls (except `llm_judge`). Each lives in its own file under `evaluators/`. Connector tool IDs in configs are already resolved to runtime tool names via `resolvedToolNames` by the time evaluators run.

| File | evaluator_type | On Fail | Logic |
|---|---|---|---|
| `tool-called.ts` | `tool_called` | `tool_not_called` | Find any tool message with matching connectorToolId (resolved). Pass if found. |
| `tool-input.ts` | `tool_input_contains` | `wrong_arguments` | Find tool call, run assertions against toolInput JSONB. |
| `no-tool-called.ts` | `no_tool_called` | `policy_violation` | Verify tool was NOT called (guardrail-style). |
| `llm-judge.ts` | `llm_judge` | `criterion_not_met` | Send criterion + transcript to LLM, parse structured verdict. Returns `skip` with reasoning "LLM judge not configured" when no API key. |

### 5a. Evaluator registry

`evaluators/index.ts` exports `getEvaluator(type: string): Evaluator` — map from type string to implementation.

### 5b. LLM judge prompt injection mitigation

Session transcripts contain user-controlled content (customer messages, external tool outputs). The LLM judge prompt uses structural delimiters and explicit instructions to mitigate injection. See ADR-007 for the full threat model and mitigation strategy.

---

## 6. Compilation Layer

The compilation function resolves all eval configs and tool names into a ready-to-execute eval plan. This is where `eval_config_id` references are looked up and connector tool IDs are resolved to runtime tool names.

```typescript
async function compileSopToEvalPlan(
  orgId: string,
  sopId: string,
  sessionId: string
): Promise<EvalPlan> {

  const sop = await sopsService.getById(orgId, sopId);
  const session = await sessionsService.getById(orgId, sessionId);
  const steps: EvalPlanStep[] = [];

  for (const step of sop.steps) {
    // Skip steps without eval config
    if (!step.evalConfigId) {
      steps.push({
        stepId: step.id, order: step.order,
        instruction: step.instruction, required: step.required,
        evaluator: null, toolNameMap: {},
      });
      continue;
    }

    // 1. Load eval config
    const cfg = await evalConfigsService.getById(orgId, step.evalConfigId);
    const evaluator: ResolvedEvaluator = {
      configId: cfg.id,
      evaluatorType: cfg.evaluatorType,
      config: cfg.config,
    };

    // 2. Resolve connector tool IDs to runtime tool names
    const toolNameMap = await resolveConnectorToolIds(orgId, cfg);

    steps.push({
      stepId: step.id, order: step.order,
      instruction: step.instruction, required: step.required,
      evaluator, toolNameMap,
    });
  }

  return { sessionId, sopId: sop.id, steps };
}
```

### 6a. Tool ID resolution

Eval configs reference tools by `connectorToolId` (UUID FK to `connector_tools`). The compilation layer resolves each ID to the runtime tool name the agent uses — computed as `{connectorSlug}_{toolSlug}` by joining `connector_tools` with `connectors`:

```typescript
async function resolveConnectorToolIds(
  orgId: string,
  evalConfig: EvalConfig
): Promise<Record<string, string>> {
  const map: Record<string, string> = {};
  const connectorToolIds = extractConnectorToolIds(evalConfig.config);

  for (const connectorToolId of connectorToolIds) {
    // Join connector_tools → connectors to compute runtime name
    // Same pattern as sops.service.ts loadSteps()
    const row = await forOrg(orgId, async (tx) =>
      tx.select({
        toolSlug: connectorTools.slug,
        connectorSlug: connectors.slug,
      })
      .from(connectorTools)
      .innerJoin(connectors, eq(connectorTools.connectorId, connectors.id))
      .where(eq(connectorTools.id, connectorToolId))
      .then(rows => rows[0])
    );

    if (!row) {
      map[connectorToolId] = connectorToolId; // Unresolved — evaluator handles gracefully
      continue;
    }

    map[connectorToolId] = `${row.connectorSlug}_${row.toolSlug}`;
  }

  return map;
}
```

Resolution computes `{connectorSlug}_{toolSlug}` — the same format stored in `session_messages.toolName`. This is consistent with the pattern in `sops.service.ts:loadSteps()`. There is no pre-computed `mcpQualifiedName` column on `connector_tools`.

---

## 7. Eval Runner (Service)

File: `evals.service.ts`

### 7a. runEvaluation(orgId, sessionId, sourceType, sourceId, options?)

1. Validate `sourceType` — only `"sop"` for now
2. Load session via `sessions.service.getSessionById()` — validate terminal status (completed | abandoned)
3. Insert `eval_runs` row (status: `running`) — the partial unique index `idx_eval_runs_active` prevents duplicate active evals (409 on conflict)
4. Compile eval plan — `compileSopToEvalPlan(orgId, sourceId, sessionId)`
5. Build `EvalContext` from session messages
6. For each step (in order):
   - If `evaluator` is null (no eval config) → skip this step entirely (no score row). The step is counted in the coverage warning in run metadata.
   - Otherwise: get evaluator via `getEvaluator(step.evaluator.evaluatorType)`, run `evaluator.evaluate(ctx, config)`, insert `eval_run_scores` row with `eval_config_id`, `required`, and `name` formatted as `step:{order}:{instruction_truncated}`
   - Short-circuit: if step `required` + result `fail` or `error` → mark remaining steps **that have eval configs** as `skip` with reasoning "Skipped: required step '{stepId}' failed" (or "errored"). Steps without eval configs are always skipped regardless of short-circuit.
7. Compute verdict: `passed = (failedOrErroredRequiredSteps === 0)`
8. Update `eval_runs` with final status, passed, duration, `updated_at`, coverage warnings in metadata
9. If reporter configured → call `reporter.report()` (fire-and-forget)
10. Return eval run with scores

### 7b. listEvalRuns(orgId, filters)

Query `eval_runs` via `forOrg(orgId)`. Filter by `sessionId`, `sourceType`, `sourceId`, `status`. Paginated.

### 7c. getEvalRunById(orgId, runId)

Load eval run + scores via `forOrg(orgId)`. Join source name (SOP name for sourceType: `"sop"`).

---

## 8. Reporter Interface

Directory: `reporters/`

### 8a. Interface

```typescript
interface EvalRunReport {
  runId: string;
  sessionId: string;
  sourceType: string;
  sourceId: string;
  sourceName: string;
  passed: boolean;
  scores: Array<{
    name: string;
    evalConfigId: string;
    evaluatorType: string;
    result: 'pass' | 'fail' | 'skip' | 'error';
    reasoning: string;
    failureClassification?: string;
    expected?: Record<string, unknown>;
    actual?: Record<string, unknown>;
  }>;
  metadata: Record<string, unknown>;
}

interface EvalReporter {
  readonly name: string;
  report(run: EvalRunReport): Promise<{ externalRunId?: string; externalRunUrl?: string }>;
}
```

### 8b. v1 implementations

| File | Reporter | Description |
|---|---|---|
| `console.ts` | `ConsoleReporter` | Logs structured JSON to stdout. Default. |

### 8c. Future implementations (Step 3+)

| Reporter | When | What it does |
|---|---|---|
| `LangfuseReporter` | Step 3 | Pushes scores to Langfuse traces. Returns Langfuse trace URL as `externalRunUrl`. |
| `BraintrustReporter` | If needed | Translates to Braintrust experiment format. |

The reporter interface is fire-and-forget. Local storage always happens first. If the reporter fails, the eval still succeeds — results are in `eval_runs`.

---

## 9. API Routes

### 9a. Eval Runs

File: `evals.routes.ts`

| Method | Path | Permission | Body/Params |
|---|---|---|---|
| `POST` | `/api/evals/runs` | `eval_runs:create` | `{ sessionId, sourceType, sourceId, reporter? }` |
| `GET` | `/api/evals/runs` | `eval_runs:read` | Query: `sessionId?`, `sourceType?`, `sourceId?`, `status?`, `page`, `pageSize` |
| `GET` | `/api/evals/runs/:runId` | `eval_runs:read` | Path: `runId` |

### 9b. Eval Configs

File: `eval-configs.routes.ts`

| Method | Path | Permission | Body/Params |
|---|---|---|---|
| `POST` | `/api/eval-configs` | `eval_configs:create` | `{ name, description?, evaluatorType, config }` |
| `GET` | `/api/eval-configs` | `eval_configs:read` | Query: `evaluatorType?`, `page`, `pageSize` |
| `GET` | `/api/eval-configs/:configId` | `eval_configs:read` | Path: `configId` |
| `PUT` | `/api/eval-configs/:configId` | `eval_configs:update` | `{ name?, description?, config? }` — `evaluatorType` is immutable after creation |
| `DELETE` | `/api/eval-configs/:configId` | `eval_configs:delete` | Path: `configId`. Fails if config is referenced by any `sop_steps`. |

Schemas in `evals.schemas.ts` and `eval-configs.schemas.ts` following the `sops.schemas.ts` pattern (Zod + OpenAPI).

---

## 10. Known Gaps & Caveats

| Gap | Status / Mitigation |
|---|---|
| Transcript windowing | Sequential steps evaluate against full transcript. Consumption-based approach (claimed tool calls excluded from subsequent evaluations) needed before shipping. |
| No-tool-call sessions | Agent resolves verbally without tools. Tool-based evaluators return `skip` (not `fail`) when no tool messages exist. |
| LLM judge uncalibrated | v1 ships uncalibrated. Calibration workflow (human labels, agreement metrics) is v2. |
| LLM judge prompt injection | Session transcripts contain user-controlled content. Mitigated via structural delimiters and explicit judge instructions. See ADR-007. |
| Steps without eval config | Steps missing `eval_config_id` are skipped. Coverage warning in run metadata: "N of M steps have no eval config assigned." |

---

## 11. Supporting Changes

| File | Change |
|---|---|
| `src/lib/middleware/rbac.ts` | Add `"eval_configs:read": ["admin", "support", "viewer"]`, `"eval_configs:create": ["admin"]`, `"eval_configs:update": ["admin"]`, `"eval_configs:delete": ["admin"]`, `"eval_runs:read": ["admin", "support", "viewer"]`, `"eval_runs:create": ["admin", "support"]` |
| `src/lib/errors.ts` | Add `EVAL_RUN_NOT_FOUND` (404), `EVAL_CONFIG_NOT_FOUND` (404), `EVAL_SESSION_NOT_TERMINAL` (400), `EVAL_ALREADY_RUNNING` (409), `EVAL_CONFIG_IN_USE` (409) |
| `src/env.ts` | Add optional `EVAL_LLM_API_KEY`, `EVAL_LLM_BASE_URL`, `EVAL_LLM_MODEL` |
| `src/app.ts` | Wire eval routes: `apiRouter.route("/evals", evalRoutes)`, `apiRouter.route("/eval-configs", evalConfigRoutes)` |
| `src/features/sops/sops.types.ts` | Add `evalConfigId?: string` to SopStep interface |
| `src/features/sops/sops.schemas.ts` | Add evalConfigId to step schema (nullable) |
| `src/features/sops/sops.service.ts` | Read evalConfigId in `loadSteps()`, persist in `insertSteps()` |

---

## 12. File Structure

```
src/features/evals/
  index.ts                    # barrel export
  evals.types.ts              # StepEvaluatorConfig, Assertion, FailureClassification
  evals.schemas.ts            # Zod schemas for API validation
  evals.service.ts            # runner + list/get queries
  evals.routes.ts             # Hono API routes
  evals.compile.ts            # compileSopToEvalPlan(), resolveConnectorToolIds()
  evaluators/
    evaluator.types.ts        # Evaluator, EvalContext, EvaluatorResult interfaces
    index.ts                  # registry (getEvaluator)
    tool-called.ts
    tool-input.ts
    no-tool-called.ts
    llm-judge.ts
    assertions.ts             # Assertion runner + safeRegexTest()
  reporters/
    reporter.types.ts         # EvalReporter, EvalRunReport interfaces
    index.ts                  # registry (getReporter)
    console.ts                # console/JSON reporter

src/features/eval-configs/
  index.ts                    # barrel export
  eval-configs.types.ts
  eval-configs.schemas.ts     # Zod validation
  eval-configs.service.ts     # CRUD for eval_configs table
  eval-configs.routes.ts      # API routes for managing configs

src/db/schema/
  enums.ts                    # evaluator_type, eval_source_type, eval_status, eval_score_result
  eval-configs.ts             # Drizzle schema for eval_configs table
  eval-runs.ts                # Drizzle schema for eval_runs + eval_run_scores
```

---

## 13. Implementation Order

1. **Types** — `evals.types.ts`, `evaluator.types.ts`, `reporter.types.ts`
2. **DB schema** — enums, `eval_configs`, `eval_runs`, `eval_run_scores` tables, schema index exports
3. **SOP step extension** — add `eval_config_id` column, update SopStep type + schema + loadSteps/insertSteps
4. **Migration** — `drizzle-kit generate --name add-evals`
5. **Eval configs CRUD** — service + API routes
6. **4 evaluators** — pure functions with failure classifications + unit tests
7. **Assertion runner** — `assertions.ts` with `safeRegexTest()` wrapper
8. **Evaluator registry** — `evaluators/index.ts`
9. **Console reporter** + registry
10. **Compilation layer** — `compileSopToEvalPlan()`, `resolveConnectorToolIds()`
11. **Eval service** — runner (with short-circuit on fail/error + coverage warnings), list, get
12. **Zod schemas** — `evals.schemas.ts`
13. **API routes** — `evals.routes.ts`
14. **Supporting changes** — RBAC, error codes, env vars, app.ts wiring
15. **Unit tests** — `tests/unit/evals/` for each evaluator + assertion runner
16. **Integration test** — full flow: seed session → create SOP with eval configs → trigger eval → verify scores + failure classifications

---

## 14. Verification

1. `make api-typecheck` — no type errors
2. `make api-lint` — passes lint
3. Unit tests: each evaluator with mock messages — verify pass/fail + correct failure classification + mandatory reasoning
4. Unit tests: `safeRegexTest()` — verify safe patterns pass, ReDoS patterns rejected, timeout enforced
5. Integration test: seed session + SOP → POST eval → verify run passed/failed + scores with classifications → GET list + detail
6. Manual: `make api-dev` → Scalar docs → trigger eval on seeded data

---

## 15. Design Rationale

### Why owned runtime + storage, not Langfuse-first?

Evals must work on localhost with zero external dependencies. Transcripts live in ModelGuide's DB — evaluators read them directly. Langfuse becomes valuable at Step 3 (score emission to existing OTel traces) and Step 4 (experiment orchestration) — not as a prerequisite to running the first eval.

### Why the reporter interface?

The eval platform landscape (Langfuse, Braintrust, LangSmith) is unsettled. The reporter interface lets us emit results to any platform without coupling the eval engine to one. Local storage always happens first; reporters are fire-and-forget on top. If the reporter fails, the eval still succeeds.

### Why eval_configs as a shared table?

The table has two consumers from day one: SOPs and guardrails. Both need reusable evaluator definitions. A shared table avoids duplicating configs across features. The table is intentionally lean — no versioning, no tags. Add those when the catalog grows.

### Why eval_config_id only, no inline evaluator or auto-infer?

Explicit is better. Every evaluated step points to a config in the shared table. No magic inference, no hidden behavior, no ambiguity about where the evaluator definition lives. Steps without an `eval_config_id` are simply not evaluated — no score row is produced, only a coverage warning in the run metadata tells you which ones are missing. This means `eval_config_id` on `eval_run_scores` is NOT NULL — every score row traces back to the config that produced it. This keeps the engine simple, the eval configs inspectable, and the scores table clean of phantom rows.

### Why eval_config_id on eval_run_scores?

Traceability. Every score knows which config produced it. Enables "show me all scores from this eval config" to measure config effectiveness, and "which config version was used for this score" when versioning is added later.

### Why evaluator_type as a column with enum, not inside config JSONB?

The type determines which evaluator function runs — that's structural, not configuration. A top-level column is queryable, indexable, and validated at the DB level. The `config` JSONB holds only the type-specific parameters. Adding new evaluator types is `ALTER TYPE evaluator_type ADD VALUE`.

### Why connectorToolId referencing connector_tools directly?

`connectorToolId` references `connector_tools` (the instance), not `connector_catalog_tools` (the definition). The SOP step says "call this specific tool on this specific connector." Resolution is a single join: connector_tools → connectors → compute `{connectorSlug}_{toolSlug}`. No catalog indirection needed.

### Why 4 evaluators, not 7?

`tool_sequence`, `tool_output_contains`, and `confirmation_requested` are niche. Ship the 4 that cover 90% of SOP steps. Add others when there's a concrete need. Each new evaluator is one file + one `ALTER TYPE`.

### Why post-hoc evaluation, not re-running inference?

Every eval platform assumes you re-invoke the model during evaluation. We evaluate real session transcripts after the fact. The agent already ran on ElevenLabs, Pipecat, or LiveKit — we forensically analyze what happened. This is fundamentally different and is our strength for the contact center use case.

### Why eval runs are immutable (no DELETE)?

Eval runs are audit records. Deleting them would break traceability — "what was the compliance score for session X on date Y?" must always be answerable. If an eval run is invalid (wrong SOP, bad config), re-run the eval. The new run supersedes the old one. See ADR-007.

### Why separate permissions for eval_configs and eval_runs?

Different access patterns. Eval configs are structural definitions (create/update restricted to admin). Eval runs are operational actions (support users trigger and review evals). Separate permission namespaces (`eval_configs:*` and `eval_runs:*`) allow fine-grained RBAC without overloading a single `evals:*` namespace.

---

## 16. Phase 2 — Deferred Scope

### 16a. Additional evaluators

| Type | Purpose | Ships with |
|---|---|---|
| `tool_sequence` | Verify tools appeared in order | When multi-step tool workflows need validation |
| `tool_output_contains` | Check assertions against tool output | When tool output verification is needed |
| `confirmation_requested` | Find confirmation before mutation | Branching PRD |
| `premature_execution` | Detect tool execution before confirmation | Branching PRD |
| `compensation_executed` | Detect missing compensation after retraction | Branching PRD |

### 16b. Eval config enhancements

| Feature | Purpose | When |
|---|---|---|
| `version` + `parent_id` columns | Independent versioning | When config iteration frequency justifies audit trail |
| `tags` column | Browsable catalog filtering | When org has 20+ configs |
| Custom evaluator interface | Pluggable evaluators | When a customer needs domain-specific compliance |

### 16c. Human review + LLM judge calibration

Langfuse annotation queues for human review. Agreement metrics (Cohen's Kappa / F1) between LLM judge and human labels. Ships when LLM judge calibration becomes a priority.
