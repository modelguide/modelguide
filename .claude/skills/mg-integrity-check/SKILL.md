---
name: mg-integrity-check
description: Use before committing significant code changes to verify project integrity. Checks code style, project structure, naming conventions, and change management rules from CONTRIBUTING.md. Trigger phrases include "pre-commit check", "integrity check", "check before commit", "review my changes", "verify changes".
---

# Pre-Commit Integrity Check

Run this checklist against the current staged or changed files before committing. Report each check as PASS, FAIL, or SKIP (not applicable). At the end, summarize all findings.

## Step 0: Gather Changed Files

Run `git diff --name-only HEAD` (unstaged) and `git diff --cached --name-only` (staged) to get the full list of changed files. Categorize them:

- **API files** — paths starting with `modelguide-api/`
- **UI files** — paths starting with `modelguide-ui/`
- **Docs files** — paths starting with `docs/`
- **DB schema files** — paths matching `modelguide-api/src/db/schema/*.ts`
- **Migration files** — paths matching `modelguide-api/drizzle/*.sql`
- **Connector files** — paths matching `modelguide-api/src/features/connectors/catalog/*/`
- **Env files** — `modelguide-api/src/env.ts`
- **Route files** — paths matching `modelguide-api/src/features/*/routes.ts` or `*.routes.ts`
- **Test files** — paths matching `modelguide-api/tests/**` or `modelguide-ui/src/**/*.test.*`

## Check 1: File Naming

For every changed file, verify:
- File name is **kebab-case** (e.g., `agent-form.tsx`, `auth.routes.ts`)
- No PascalCase or camelCase file names (exception: `SKILL.md`, `CLAUDE.md`, `README.md`, `CONTRIBUTING.md`)
- Route files follow TanStack Router convention: `name.tsx` or `name.$param.tsx`

## Check 2: File Location

For every changed source file, verify it lives in the correct directory:
- API feature code → `modelguide-api/src/features/<feature>/`
- API shared utilities → `modelguide-api/src/lib/`
- API DB schema → `modelguide-api/src/db/schema/`
- UI feature components → `modelguide-ui/src/features/<feature>/`
- UI shared primitives → `modelguide-ui/src/components/ui/`
- UI layout components → `modelguide-ui/src/components/layout/`
- UI routes → `modelguide-ui/src/routes/`
- UI stores → `modelguide-ui/src/stores/`
- UI schemas → `modelguide-ui/src/schemas/`

Flag any source file that lives outside these directories (e.g., code directly in `src/` root).

## Check 3: Import Aliases

Read changed API files and verify:
- Imports use path aliases: `@features/*`, `@lib/*`, `@db/*`, `@/*`
- No deep relative imports like `../../lib/` or `../../../db/` (one level `./` within the same feature is fine)

Read changed UI files and verify:
- Imports use `~/` alias (e.g., `~/lib/api`, `~/components/ui/button`)
- No deep relative imports

## Check 4: API Route Conventions

If any new route files are added or modified:
- Routes use `@hono/zod-openapi` for request/response validation
- Route is registered in `modelguide-api/src/app.ts`
- Handler has Zod schemas for request params, body, and response

## Check 5: UI Patterns

If UI component files are changed:
- Component variants use CVA (`cva()` from `class-variance-authority`)
- Data fetching uses TanStack Query (`useQuery`, `useMutation`)
- Client state uses Zustand (not React Context for global state)
- Form validation uses Zod schemas

These are guidelines — only flag if a new component introduces a different pattern (e.g., raw `fetch()` instead of TanStack Query, or inline styles instead of CVA).

## Check 6: Database Changes

If any files in `modelguide-api/src/db/schema/` are modified:
- Check that a corresponding migration file exists in `modelguide-api/drizzle/`
- If no new migration is staged, warn: "Schema changed but no migration found. Run `bunx drizzle-kit generate --name <descriptive-name>`"
- If the change is significant (new table, new pattern, security model change), check for an ADR in `docs/decisions/`

## Check 7: Environment Variables

If `modelguide-api/src/env.ts` is modified (variables added, renamed, or removed):
- Check that `railway/DEPLOY.md` is also modified in this changeset
- If not, warn: "Env vars changed but railway/DEPLOY.md not updated (steps 3 and 8 list production vars)"

## Check 8: Test Coverage

For new files added in this changeset:
- New API route → should have corresponding test in `modelguide-api/tests/unit/` or `tests/integration/`
- New connector handler → should have test in `modelguide-api/tests/unit/connectors/`
- New UI feature component → should have test file

Only flag **missing** tests for **new** files. Don't flag modifications to existing files that already have tests.

## Check 9: Connector Module Integrity

If any connector files are changed (paths matching `catalog/*/`):
- The connector directory has all 3 files: `client.ts`, `handlers.ts`, `index.ts`
- Handlers use the `with{Name}()` HOF wrapper (grep for the pattern)
- No raw `throw` in handler functions (errors should be returned via the wrapper)
- Mutation tools have `defaultRequiresConfirmation: true` in the manifest
- The connector is imported in `modelguide-api/src/features/connectors/catalog/registry.ts`

## Check 10: Security

Across all changed files:
- No hardcoded secrets, API keys, or credentials (grep for patterns like `sk_`, `mgk_`, `Bearer `, passwords)
- No `.env` files being committed (should be gitignored)
- Connector config fields storing secrets use `type: "secret"` in `configSchema`

## Report Format

After running all checks, output a summary:

```
## Integrity Check Results

Files checked: N

| # | Check | Result | Details |
|---|-------|--------|---------|
| 1 | File naming | PASS | |
| 2 | File location | PASS | |
| 3 | Import aliases | FAIL | `modelguide-api/src/features/agents/foo.ts` uses relative import `../../lib/crypto` |
| ... | ... | ... | ... |

### Issues to Fix (N)
- [FAIL] Check 3: ...

### Warnings (N)
- [WARN] Check 6: Schema changed but no migration found

### All Clear
✓ No blocking issues found. Ready to commit.
```

Report FAIL for violations that should be fixed before committing. Report WARN for advisory items the developer should consider. SKIP checks that don't apply to the current changeset.
