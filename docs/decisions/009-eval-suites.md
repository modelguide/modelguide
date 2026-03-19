# ADR-009: Eval Suites

**Status:** Accepted

## Context

ADR-007 established the evaluation engine — eval_configs, eval_runs, evaluators, and a compilation layer that resolves SOP steps to assertions. This works for ad-hoc evaluation of individual sessions against SOPs, but lacks structure for repeatable, growing test suites.

The Agent Quality System architecture (v8) defines an EvalSuite as a first-class entity — the quality bar for an agent. It starts auto-generated from an SOP and grows through human curation as failures are found. Phase 2 delivers the suite infrastructure; Phase 3 adds simulation runner, replay tests, and async execution.

Key requirements:
- Auto-generate suites from SOPs (derive test cases and evaluators from steps + guardrails)
- Support manual suites for hand-written agents without SOPs
- Assertions must be per-test-case, not per-suite (branching SOPs have different paths)
- Suite scores existing sessions — it's a scorer, not a simulator
- Single eval entry point (replace the legacy SOP-based eval path)

## Decision

### Table relationships

```
eval_suites                              eval_configs (ADR-007)
├── agent_id FK → agents (cascade)       ┌──────────────┐
├── sop_id FK → sops (nullable)          │ eval_configs  │
│                                        │ (reusable)    │
├── eval_suite_test_cases                │ evaluator_type│
│   ├── source: auto | manual            │ config: JSONB │
│   │                                    └──────┬───────┘
│   └── eval_suite_evaluators ──────────────────┘
│       ├── required: boolean
│       ├── sop_step_id (traces origin)
│       └── source: auto | manual
│
└── eval_suite_runs
    │   prompt_source: compiled | hand_written | edited
    │   started_at, completed_at, duration_ms
    │   (NO cached pass/fail — aggregated at query time)
    │
    └──► eval_runs (ADR-007)
         ├── suite_run_id FK (set null on delete)
         ├── test_case_id FK
         ├── source_type: "suite"
         └── eval_run_scores (unchanged)
```

All new tables are org-scoped with RLS enabled (`organization_id` FK + SELECT/INSERT policies).

### Practical example: WISMO SOP → EvalSuite

Given a WISMO SOP with 5 steps:

| # | Step | Required | Tool |
|---|------|----------|------|
| 1 | Classify intent | true | — |
| 2 | Extract order number | true | — |
| 3 | Look up order | true | `store_look_up_order` |
| 4 | Compose reply | true | — |
| 5 | Escalate if needed | false | `helpdesk_create_ticket` |

`initSuiteFromSop` produces a single test case with evaluators for ALL steps:

```
EvalSuite: "Eval: Email — Order Not Arrived"
│
└── TestCase: "Eval: Email — Order Not Arrived" (source: auto)
    ├── assertion: step:1:llm_judge (classify) — required: true
    ├── assertion: step:2:llm_judge (extract)  — required: true
    ├── assertion: step:3:tool_called (store_look_up_order) — required: true
    ├── assertion: step:4:llm_judge (compose)  — required: true
    └── assertion: step:5:tool_called (helpdesk_create_ticket) — required: false
```

Required steps get `required: true` evaluators; optional steps get `required: false` evaluators. Guardrail KB evaluators (if any) are also added with `required: true`.

### Evaluators belong to test cases, not suites

Evaluators are scoped to test cases rather than suites. The auto-generated test case includes all evaluators (required and optional), but manual test cases can have their own evaluator sets. Suite-level evaluators would force every test case through the same checks, which is wrong when manual test cases target specific scenarios.

### Two creation paths

1. **`initSuiteFromSop(orgId, agentId, sopId)`** — SOP-based. Creates a single auto-generated test case with evaluators for ALL SOP steps (`tool_called` for tool steps, `llm_judge` for instruction steps). Required steps get `required: true` evaluators; optional steps get `required: false`. Guardrail KB evaluators are also added. Supports re-initialization: deletes auto-generated test cases, preserves manual ones. `sopId` is required.

2. **`createSuite(orgId, { agentId, name, sopId? })`** — Manual. Creates an empty suite. User populates test cases and evaluators via CRUD endpoints. `sopId` is optional metadata — no derivation.

These are separate service functions and API routes. They don't share implementation because they solve different problems.

### Suite scores existing sessions

`runEvalSuite(orgId, suiteId, sessionId, promptSource)` takes an explicit `sessionId`. The suite is a scorer, not a simulator. Agent execution happens elsewhere:
- Production conversations (live sessions)
- Test runs (E2E tests call `agent.generate()` + `storeSyntheticSession()`)
- Simulation runner (Phase 3 — generates sessions, then calls `runEvalSuite`)

This separation means the suite can score any session regardless of origin.

### Execution flow

```
POST /api/eval-suites/:suiteId/run  { sessionId, promptSource }
│
├── Validate: suite exists, not archived, agent has compiled_instructions
├── Validate: suite has test cases, each test case has evaluators
│
├── Create eval_suite_runs row
│
├── For each test case:
│   ├── resolveAssertions(testCaseId)
│   │   ├── Load eval_suite_evaluators → eval_configs
│   │   ├── Extract connectorToolIds from configs
│   │   └── Resolve tool names at scoring time (connector_tools ⋈ connectors)
│   │
│   ├── Create eval_runs row (sourceType: "suite", sourceId: suite.id)
│   ├── Load session_messages for sessionId
│   ├── executeAssertions(resolved, messages) → eval_run_scores
│   └── Update eval_runs (passed, durationMs, completedAt)
│
└── Update eval_suite_runs (completedAt, durationMs)
```

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

## Alternatives Considered

- **Suite-level evaluators** — rejected: forces every test case through the same checks. Wrong for branching SOPs where different paths exercise different tools. Per-test-case evaluators are more work to implement but correctly model SOP path divergence.

- **Single creation path with optional `sopId`** — rejected: SOP-based and manual suites have fundamentally different semantics. A single function with `if (sopId)` branching creates confusion about what's required and what's derived. Two functions with clear contracts are easier to reason about.

- **Suite generates sessions (build agent + run + store)** — rejected: couples the scorer to agent execution. The simulation runner (Phase 3) is the right place for transcript generation. The suite should score any session regardless of how it was created — production, test, simulated, replayed.

- **Cached pass/fail counters on eval_suite_runs** — rejected: cached counters rot. One missed update and the counter disagrees with `eval_run_scores`. For the expected volume (3-15 test cases), query-time aggregation is negligible.

- **Literal LLM judge criteria ("The agent followed this instruction: ...")** — rejected after E2E testing showed false negatives. The LLM judge interprets "followed" literally and expects the agent to narrate its reasoning. Behavior-focused criteria ("demonstrates correct performance") evaluate actions, not narration.

- **`expectedToolCalls` / `unexpectedToolCalls` columns on test cases** — rejected: duplicates what evaluators already express. A `tool_called` evaluator on a test case IS the expected tool call. Two parallel mechanisms for the same thing creates confusion about which is authoritative. Evaluators are the single source of truth.

- **Keep legacy SOP eval path alongside suites** — rejected: two eval entry points with overlapping functionality. The suite IS the SOP-derived eval, but better — it supports manual evaluators, path-based test cases, and re-initialization. One path is simpler than two.

## Future Direction: Knowledge Base Testing

Currently only guardrails (KB type `guardrail`) are auto-derived into evaluators by `initSuiteFromSop`. Other KB content types — FAQ, personalization, company profile — are not covered by auto-generation.

Two future paths for KB-based evaluation:

1. **KB-derived suites** — `initSuiteFromKnowledgeBase(agentId, kbId)` creates a standalone suite with evaluators derived from KB entries. Each FAQ entry becomes an `llm_judge` evaluator ("agent answer is consistent with: {faq_content}"). Personality rules become tone/style evaluators. No SOP required.

2. **Pin KB evaluators to SOP suites** — extend `initSuiteFromSop` to derive evaluators from additional KB types beyond guardrails. FAQ and personality evaluators would be pinned to all test cases, same pattern as guardrails today. Every SOP eval run also checks KB compliance.

Both paths reuse the existing `eval_configs` + `eval_suite_evaluators` infrastructure. No new tables or evaluator types needed — `llm_judge` with KB-derived criteria handles all cases.

## Open Considerations

- **"Guardrail" terminology overload** — The term "guardrail" is used for two different concepts: (1) KB guardrail entries (behavioral constraints like "never call customer by surname"), and (2) the former "guardrail path" test case category (testing that the agent handles disallowed scenarios). The 3-path model has been replaced by a single test case with `required` flags, but if we reintroduce scenario categories in the future, we should use "unhappy scenario" or "boundary case" instead of "guardrail path" to avoid confusion with KB guardrails. (ref: PR #153 review comment from @pekunicki)

## Consequences

- Suites are the single eval entry point — no more ad-hoc SOP evaluation
- Manual suites support hand-written agents without SOPs
- Single auto-generated test case per SOP with required/optional evaluators matching step requirements
- Re-initialization preserves human curation work (manual test cases survive SOP changes)
- Async execution (Phase 3) will require changing `runEvalSuite` to return immediately and process in background — the current inline execution is acceptable for Phase 2 volume
- The `storeSyntheticSession` production service bridges agent runners and the eval scorer — any code that runs an agent can produce a scoreable session
- `eval_configs` accumulate over time (auto-created, never deleted) — orphaned configs are harmless but may need cleanup tooling eventually
- Removing the legacy eval path is a breaking change for any code that called `POST /api/evals/runs` — acceptable since it was only used in tests, not by external consumers
- Naming inconsistency: `eval_suite_evaluators` (what to check) produces results in `eval_run_scores` (what happened). `eval_run_results` would be more natural, but `eval_run_scores` is pre-existing from ADR-007. Consider renaming in a future cleanup
