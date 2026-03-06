## Goal

Harden all CRUD endpoints with consistent HTTP status codes, strict input validation, and proper duplicate/conflict handling. Today, PATCH endpoints silently drop unknown fields and agents lack slug uniqueness checks.

## Acceptance Criteria

### New behavior

1. All PATCH request body schemas reject unknown fields — Zod `.strict()` via `@hono/zod-openapi` returns **422** with `unrecognized_keys` in the error details
2. Creating an agent with a duplicate slug (within the same org) returns **409** with `{ code: "ALREADY_EXISTS" }`

### Regression coverage (test-only — no code changes expected)

5. Integration tests verify all DELETE endpoints return 204 (no body)
6. Integration tests verify GET/PATCH/DELETE on non-existent resources return 404

## Constraints

- Use existing `Errors.*` factories from `src/lib/errors.ts` — add new error codes only if no existing one fits
- Apply `.strict()` at the Zod schema level (not middleware) so OpenAPI docs reflect the strict contract
- Only strictify request bodies — leave query param schemas as-is (strip behavior)

## Dependencies

None

## Technical Approach

Two independent workstreams — can be done in any order:

**Strict PATCH schemas** — Find every update body schema across all feature modules and add `.strict()`. SOPs already has this; the rest don't. `@hono/zod-openapi` should surface Zod's `unrecognized_keys` error as 422 automatically — verify this with a quick test before applying everywhere, and add a custom error mapper only if it doesn't.

**Agent slug uniqueness** — `createAgent()` generates a slug from the name but never checks uniqueness before insert. Add a pre-insert query and throw `Errors.alreadyExists("Agent", "slug")` on conflict. Prefer this over catching the DB unique constraint error — it gives a clean 409 with a descriptive message.

## Test Plan

All new tests go into their respective feature test files — no shared `crud-audit.test.ts`. Each module's existing integration test file gets new cases:

- [ ] `agents.test.ts` — PATCH unknown field → 422; duplicate slug on create → 409; DELETE → 204; not-found → 404
- [ ] `connectors.test.ts` — PATCH unknown field → 422; DELETE → 204; not-found → 404
- [ ] `secrets.test.ts` — PATCH unknown field → 422; DELETE → 204; not-found → 404
- [ ] `sessions.test.ts` — PATCH unknown field → 422; not-found → 404
- [ ] `sops.test.ts` — PATCH unknown field → 422 (should already pass); DELETE → 204; not-found → 404
- [ ] `feedback.test.ts` — PATCH unknown field → 422
- [ ] All existing tests still pass (`make api-test`)

## Out of Scope (Phase 2+)

| Item | When | Why deferred |
|---|---|---|
| Connector config validation on update | #73 (secret refs redesign) | Current config is flat JSONB — no way to identify secret refs without catalog schema lookup. Deferred until secret refs are self-describing |
| Cascade delete audit (orphan rows) | When we add soft-delete or audit logging | Needs holistic cascade policy design |
| Slug immutability on PATCH | When slugs appear in external URLs or MCP tool names | No external consumers depend on slug stability yet |
| Typed OpenAPI error responses (409/422) | When we generate client SDKs | Clients handle error bodies ad-hoc today |

## Design Rationale

### Why `.strict()` at schema level?
OpenAPI docs automatically reflect the strict contract — generated clients know exactly which fields are allowed. A middleware approach rejects unknown fields but isn't visible in the API spec.
