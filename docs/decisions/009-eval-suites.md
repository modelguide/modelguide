# ADR-009: Eval Suites

**Status:** Accepted

## Context

ADR-007 established the evaluation engine — eval_configs, eval_runs, evaluators, and a compilation layer that resolves SOP steps to assertions. This works for ad-hoc evaluation of individual sessions against SOPs, but lacks structure for repeatable, growing test suites.

The Agent Quality System architecture (v8) defines an EvalSuite as a first-class entity — the quality bar for an agent. It starts auto-generated from an SOP and grows through human curation as failures are found. Phase 2 delivers the suite infrastructure; Phase 3 adds simulation runner, replay tests, and async execution.

Key requirements:
- Auto-generate suites from SOPs (derive test cases and assertions from steps + guardrails)
- Support manual suites for hand-written agents without SOPs
- Assertions must be per-test-case, not per-suite (branching SOPs have different paths)
- Suite scores existing sessions — it's a scorer, not a simulator
- Single eval entry point (replace the legacy SOP-based eval path)

## Decision

### Table relationships

```
eval_suites
├── agent_id FK → agents (cascade)
├── sop_id FK → sops (cascade, nullable — null for manual suites)
│
├── eval_suite_test_cases (cascade delete)
│   ├── eval_suite_assertions (cascade delete)
│   │   └── eval_config_id FK → eval_configs (NO cascade — configs are shared)
│   └── source: auto | manual
│
└── eval_suite_runs (thin aggregator, no cached counters)
    └── eval_runs.suite_run_id FK (set null on delete)
        └── eval_run_scores (unchanged from ADR-007)
```

All tables are org-scoped with RLS enabled (`organization_id` FK + policies).

### Assertions belong to test cases, not suites

Different test cases exercise different SOP paths. For a WISMO SOP with an escalation branch:

- **Happy path** test case checks: classify (llm_judge), lookup order (tool_called), compose reply (llm_judge)
- **Guardrail** test case checks: classify (llm_judge), create ticket (tool_called)

Suite-level assertions would force both test cases through the same checks, producing false failures on branching SOPs. Each test case carries only the assertions relevant to its path.

### Two creation paths

1. **`initSuiteFromSop(orgId, agentId, sopId)`** — SOP-based. Derives 3 path-based test cases (happy/edge/guardrail) and auto-creates eval_configs from SOP steps (tool_called for tool steps, llm_judge for instruction steps) and guardrails. Supports re-initialization: deletes auto-generated test cases, preserves manual ones. `sopId` is required.

2. **`createSuite(orgId, { agentId, name, sopId? })`** — Manual. Creates an empty suite. User populates via CRUD endpoints. `sopId` is optional metadata — no derivation.

These are separate service functions and API routes. They don't share implementation because they solve different problems.

### Suite scores existing sessions

`runEvalSuite(orgId, suiteId, sessionId, promptSource)` takes an explicit `sessionId`. The suite is a scorer, not a simulator. Agent execution happens elsewhere:
- Production conversations (live sessions)
- Test runs (E2E tests call `agent.generate()` + `storeSyntheticSession()`)
- Simulation runner (Phase 3 — generates sessions, then calls `runEvalSuite`)

This separation means the suite can score any session regardless of origin.

### Legacy SOP eval path removed

The `runEvaluation(orgId, sessionId, "sop", sopId)` function and `POST /api/evals/runs` endpoint have been removed. Suite is the single eval entry point. The `eval_source_type` enum is now `["suite", "replay_test", "live"]` — `"sop"` remains in the DB enum but is unused by code.

### Behavior-focused LLM judge criteria

Auto-generated `llm_judge` criteria for instruction-only SOP steps use behavior-focused language:

```
"The agent's response demonstrates that it correctly performed this step: '<instruction>'.
The agent does not need to explicitly state it performed this step — behavioral evidence is sufficient."
```

This prevents false negatives when the agent acts correctly without narrating its reasoning (e.g., classifying intent by choosing the right tool path rather than saying "I classify this as...").

### eval_suite_runs is a thin aggregator

No cached `passed` column or `summary` counters. Pass/fail is computed at query time from `eval_runs WHERE suite_run_id = ?`. For 3-15 test cases per suite, query-time aggregation is negligible. This keeps `eval_runs` + `eval_run_scores` as the single source of truth.

### Compiled instructions on agents table

`agents` gains `compiled_instructions TEXT`, `compiled_at TIMESTAMPTZ`, `compiled_from JSONB`. This is the single instructions field — set by compilation (`POST /api/compiler/agents/:agentId/compile`) or direct update (`PATCH /api/agents/:id`). Migrates to `agent_versions` in Phase 5.

### Tool name resolution at scoring time

Assertions reference eval_configs which store `connectorToolId` (UUID). `resolveAssertions()` resolves to runtime names (`{connectorSlug}_{toolSlug}`) at scoring time by joining `connector_tools` + `connectors`. This prevents stale mappings if connectors are reconfigured after suite creation.

## Consequences

- Suites are the single eval entry point — no more ad-hoc SOP evaluation
- Manual suites support hand-written agents without SOPs
- Path-based test cases correctly handle branching SOPs (escalation paths, conditional tools)
- Re-initialization preserves human curation work (manual test cases + assertions survive SOP changes)
- Async execution (Phase 3) will require changing `runEvalSuite` to return immediately and process in background — the current inline execution is acceptable for Phase 2 volume
- The `storeSyntheticSession` production service bridges agent runners and the eval scorer — any code that runs an agent can produce a scoreable session
- `eval_configs` accumulate over time (auto-created, never deleted) — orphaned configs are harmless but may need cleanup tooling eventually
