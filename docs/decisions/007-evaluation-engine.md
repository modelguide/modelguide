# ADR-007: Evaluation Engine

**Status:** Accepted

## Context

ModelGuide records agent sessions and defines expected behavior via SOPs (ADR-005), but has no way to verify whether sessions actually followed the SOP. Customer-facing teams need compliance scoring — did the agent call the right tools, with the right arguments, and avoid banned actions?

The eval platform landscape (Langfuse, Braintrust, LangSmith) assumes you re-invoke the model during evaluation. Our agents run on external platforms (ElevenLabs, Pipecat, LiveKit) — we forensically analyze real session transcripts post-hoc, not re-run inference. This requires an owned eval engine.

## Decision

### Owned runtime + storage, external reporters optional

Evals execute locally with zero external dependencies. Session transcripts live in our DB — evaluators read them directly. External platforms (Langfuse, Braintrust) are optional reporters for analytics, connected via a fire-and-forget reporter interface. Local storage always happens first; reporter failure never blocks eval completion.

### Eval configs as shared entity

Reusable evaluator definitions stored in `eval_configs`, org-scoped with RLS. Each config has a `evaluator_type` column (DB enum) plus a `config` JSONB with type-specific parameters. The type is structural (determines which evaluator runs), not configuration — hence a column, not nested in JSONB. Queryable, indexable, validated at the DB level.

SOP steps reference eval configs by `eval_config_id` (FK on `sop_steps`). We allow missing configs only for intentionally optional coverage gaps. Required steps should always have a valid eval config. Steps without a config are not evaluated — the runner produces a coverage warning in run metadata instead of a phantom score row. This keeps the scores table clean: every `eval_run_scores` row traces back to the config that produced it (`eval_config_id NOT NULL`).

### Four evaluators for v1

| Evaluator | On Fail | Purpose |
|---|---|---|
| `tool_called` | `tool_not_called` | Verify a specific tool was called |
| `tool_input_contains` | `wrong_arguments` | Verify tool was called with correct input assertions |
| `no_tool_called` | `policy_violation` | Verify a banned tool was NOT called (guardrail) |
| `llm_judge` | `criterion_not_met` | LLM-based criterion evaluation of transcript |

All evaluators are pure functions: `(EvalContext, config) -> EvaluatorResult`. No side effects except `llm_judge` (LLM API call). Each returns mandatory `reasoning`, optional `expected`/`actual`, and a `failureClassification` on fail. New evaluators are one file + `ALTER TYPE evaluator_type ADD VALUE`.

### Compilation layer resolves tool references

Eval configs reference tools by `connectorToolId` (UUID FK to `connector_tools`). The compilation layer resolves each to the runtime tool name via `connector_tools -> connectors -> {connectorSlug}_{toolSlug}`. This is the same name format stored in `session_messages.toolName`. Unresolved IDs (deleted tools) fall back to the raw UUID — evaluators handle gracefully.

### Binary scoring with short-circuit

- **Per-step:** pass / fail / skip / error
- **Per-run:** `passed = true` when zero required steps failed or errored
- **Short-circuit:** If a required step fails or errors, remaining steps with eval configs are marked `skip` with reasoning. Optional steps without configs are excluded from scoring and appear as coverage warnings.
- **Skip semantics:** Tool evaluators return `skip` (not fail) when no tool messages exist (verbal resolution). Skips don't affect the verdict.

### Eval runs are immutable (no DELETE API)

Eval runs are compliance audit records. Deletion would break audit trail integrity and enable hiding non-compliant results. If a run is invalid (wrong SOP, misconfigured config), the correct action is to re-run. Both runs remain in the audit trail. Time-based archival (not per-record deletion) addresses storage concerns later.

### LLM judge prompt injection mitigation

Session transcripts contain user-controlled content. The judge prompt mitigates injection via:

1. **Structural delimiters** with unique boundary markers (`eval-{runId}-{scoreOrder}`)
2. **Explicit data-only instruction** in the system prompt
3. **Structured JSON output** — free-text manipulation can't change verdict format
4. **Uncalibrated label** — v1 results are best-effort, not ground truth

Accepted residual risk: sophisticated injection may influence reasoning quality, though structured output limits verdict manipulation. Human-label calibration (future) will measure and bound this risk.

### Separate RBAC for configs vs runs

Different access patterns justify separate permission namespaces:
- `eval_configs:create/update/delete` — admin only (structural definitions)
- `eval_configs:read` — all roles
- `eval_runs:create` — admin + support (operational trigger)
- `eval_runs:read` — all roles

### Three-table storage model

| Table | Purpose | RLS |
|---|---|---|
| `eval_configs` | Reusable evaluator definitions | org-scoped |
| `eval_runs` | One row per evaluation of session against source | org-scoped |
| `eval_run_scores` | One row per score in a run, with `eval_config_id` traceability | org-scoped |

### Assertion engine

Six operators for `tool_input_contains`: `equals`, `contains`, `gt`, `lt`, `exists`, `matches`. The `matches` operator uses safe regex execution with length limits, disallowed ReDoS patterns, and execution timeouts.

## Consequences

- Evals work on localhost with zero external services — `ANTHROPIC_API_KEY` optional (only for `llm_judge`, which returns `skip` without it)
- LLM judge results carry "uncalibrated" label — consumers must not treat as ground truth
- No eval run deletion mechanism — acceptable at expected volume (tens of runs/day)
- Coverage warnings surface intentionally uncovered optional steps and help track remaining coverage work
- The reporter interface decouples eval execution from analytics platforms, avoiding vendor lock-in
- Adding new evaluator types requires one file + one DB enum addition — low friction
