# ADR-014: No scope field on suite runs for partial execution

**Status:** Accepted

## Context

Filtered suite runs (running a subset of test cases) raise the question: should the run record declare whether it was a full or partial run?

- **(A) Derive from result count** -- `testCaseResults.length < suite.testCases.length` means partial. No schema change.
- **(B) Add `scope` enum** (`full | partial`) to `eval_suite_runs`.

## Decision

Option A -- derive, don't store.

## Rationale

- The API already accepts `testCaseIds` and filters execution. The run record contains exactly the test case results that were executed. Comparing count to total is trivial and always accurate.
- A `scope` column is denormalized state: it could drift if test cases are added/removed from the suite after the run. The derived approach is always consistent with the actual data.
- If we later need to query "show me only full runs" at scale, a computed column or view is simpler than maintaining an enum that must be set correctly at write time.

## Consequences

- UI must compute partial status client-side (or API adds it to the response as a computed field) -- minor complexity.
- No migration needed for this aspect of the feature.
