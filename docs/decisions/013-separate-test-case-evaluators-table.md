# ADR-013: Separate eval_test_case_evaluators table vs. extending eval_suite_evaluators

**Status:** Accepted

## Context

Per-case overrides need a storage location. Two approaches:

- **(A) New `eval_test_case_evaluators` table** -- Mirrors `eval_suite_evaluators` structure but with `test_case_id` FK and `override_type` column.
- **(B) Nullable `test_case_id` on existing `eval_suite_evaluators`** -- NULL = suite-level, non-NULL = case-level.

## Decision

Option A -- new table.

## Rationale

- `eval_suite_evaluators` is a clean suite-level junction table. Adding nullable `test_case_id` turns every query into a filter: `WHERE test_case_id IS NULL` for suite evaluators, `WHERE test_case_id = X` for case overrides. Easy to forget, producing incorrect results silently.
- Option B cannot express `exclude` without a sentinel value or additional column -- the row's existence with a non-NULL `test_case_id` is ambiguous (is it an addition or an exclusion?).
- Option A makes the override semantic explicit via `override_type` enum. Querying "what's overridden for this case?" is a single-table scan with no NULL gymnastics.
- The cost is one additional table and migration. Given that this table is small (overrides are the exception, not the rule), the storage and index overhead is negligible.

## Consequences

- Cleanup logic needed when deleting suite evaluators: must remove orphaned `exclude` overrides in `eval_test_case_evaluators` referencing the deleted config.
- Two tables to join when building the effective evaluator list -- but this only happens in `resolveAssertions()`, a single code path.
