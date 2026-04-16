# ADR-012: Evaluator inheritance model -- suite defaults with per-case overrides

**Status:** Accepted

## Context

The eval system needs per-test-case evaluator customization. A test case for "handles refund" needs `tool_called: process_refund` while "handles greeting" needs `no_tool_called`. Three approaches were considered:

- **(A) Suite defaults + per-case overrides** -- Suite evaluators apply to all cases. Cases can `add` extra evaluators or `exclude` inherited ones. Merge at runtime.
- **(B) Fully per-case evaluators** -- No suite-level defaults. Every case declares its own evaluator set.
- **(C) Branching inside evaluator logic** -- Keep suite-level only. Per-case differentiation encoded in evaluator `config` JSONB (e.g., "only applies to cases tagged X").

Industry research (Braintrust, LangSmith, Promptfoo, DeepEval, Ragas) found that Promptfoo's `defaultTest.assert[]` pattern (option A) is the only framework with declarative inheritance. Others define evaluators at the experiment level and branch inside scorer code (option C). No major framework uses fully per-case (option B).

## Decision

Option A -- suite defaults with per-case overrides.

## Rationale

- Option B creates config explosion: 50 test cases x 5 SOP evaluators = 250 rows to maintain, all identical except for the 2-3 cases that actually differ. Violates DRY at the data level.
- Option C pushes evaluator scoping into JSONB config, making it invisible to the UI and impossible to query relationally. "Which cases exclude this evaluator?" becomes a JSONB search instead of a simple FK query.
- Option A preserves the SOP compliance signal ("every case passes these guardrails") while allowing surgical exceptions. The merge logic (`suite_evals - excludes + adds`) is simple and predictable.

## Consequences

- `resolveAssertions()` gains a `testCaseId` parameter and merge logic -- small increase in runtime complexity.
- UI must render inherited vs. overridden state -- more complex than a flat list, but more informative.
- Future evaluator features (e.g., conditional evaluators, evaluator groups) build naturally on this inheritance model.
