# ADR-012: Evaluator override model for per-test-case customization

**Status:** Accepted

This ADR covers three related decisions for the per-test-case evaluator override system: the inheritance model, schema design, and run scope derivation.

---

## 1. Inheritance model — suite defaults with per-case overrides

### Context

The eval system needs per-test-case evaluator customization. A test case for "handles refund" needs `tool_called: process_refund` while "handles greeting" needs `no_tool_called`. Three approaches were considered:

- **(A) Suite defaults + per-case overrides** — Suite evaluators apply to all cases. Cases can `add` extra evaluators or `exclude` inherited ones. Merge at runtime.
- **(B) Fully per-case evaluators** — No suite-level defaults. Every case declares its own evaluator set.
- **(C) Branching inside evaluator logic** — Keep suite-level only. Per-case differentiation encoded in evaluator `config` JSONB (e.g., "only applies to cases tagged X").

Industry research (Braintrust, LangSmith, Promptfoo, DeepEval, Ragas) found that Promptfoo's `defaultTest.assert[]` pattern (option A) is the only framework with declarative inheritance. Others define evaluators at the experiment level and branch inside scorer code (option C). No major framework uses fully per-case (option B).

### Decision

Option A — suite defaults with per-case overrides.

### Rationale

- Option B creates config explosion: 50 test cases × 5 SOP evaluators = 250 rows to maintain, all identical except for the 2-3 cases that actually differ. Violates DRY at the data level.
- Option C pushes evaluator scoping into JSONB config, making it invisible to the UI and impossible to query relationally. "Which cases exclude this evaluator?" becomes a JSONB search instead of a simple FK query.
- Option A preserves the SOP compliance signal ("every case passes these guardrails") while allowing surgical exceptions. The merge logic (`suite_evals - excludes + adds`) is simple and predictable.

### Consequences

- `resolveAssertions()` gains a `testCaseId` parameter and merge logic — small increase in runtime complexity.
- UI must render inherited vs. overridden state — more complex than a flat list, but more informative.
- Future evaluator features (e.g., conditional evaluators, evaluator groups) build naturally on this inheritance model.

---

## 2. Schema design — separate `eval_test_case_evaluators` table

### Context

Per-case overrides need a storage location. Two approaches:

- **(A) New `eval_test_case_evaluators` table** — Mirrors `eval_suite_evaluators` structure but with `test_case_id` FK and `override_type` column.
- **(B) Nullable `test_case_id` on existing `eval_suite_evaluators`** — NULL = suite-level, non-NULL = case-level.

### Decision

Option A — new table.

### Rationale

- `eval_suite_evaluators` is a clean suite-level junction table. Adding nullable `test_case_id` turns every query into a filter: `WHERE test_case_id IS NULL` for suite evaluators, `WHERE test_case_id = X` for case overrides. Easy to forget, producing incorrect results silently.
- Option B cannot express `exclude` without a sentinel value or additional column — the row's existence with a non-NULL `test_case_id` is ambiguous (is it an addition or an exclusion?).
- Option A makes the override semantic explicit via `override_type` enum. Querying "what's overridden for this case?" is a single-table scan with no NULL gymnastics.
- The cost is one additional table and migration. Given that this table is small (overrides are the exception, not the rule), the storage and index overhead is negligible.

### Consequences

- Cleanup logic needed when deleting suite evaluators: must remove orphaned `exclude` overrides in `eval_test_case_evaluators` referencing the deleted config.
- Two tables to join when building the effective evaluator list — but this only happens in `resolveAssertions()`, a single code path.

---

## 3. Run scope — derive partial/full from result count

### Context

Filtered suite runs (running a subset of test cases) raise the question: should the run record declare whether it was a full or partial run?

- **(A) Derive from result count** — `testCaseResults.length < suite.testCases.length` means partial. No schema change.
- **(B) Add `scope` enum** (`full | partial`) to `eval_suite_runs`.

### Decision

Option A — derive, don't store.

### Rationale

- The API already accepts `testCaseIds` and filters execution. The run record contains exactly the test case results that were executed. Comparing count to total is trivial and always accurate.
- A `scope` column is denormalized state: it could drift if test cases are added/removed from the suite after the run. The derived approach is always consistent with the actual data.
- If we later need to query "show me only full runs" at scale, a computed column or view is simpler than maintaining an enum that must be set correctly at write time.
- Note: if a test case is deleted after a run, old runs may gain a spurious "partial" badge. This is acceptable — the alternative (storing scope) has worse failure modes.

### Consequences

- UI must compute partial status client-side (or API adds it to the response as a computed field) — minor complexity.
- No migration needed for this aspect of the feature.
