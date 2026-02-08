# ADR 002: Deployment Strategy

**Status:** Accepted

## Context

ModelGuide needs a deployment strategy that supports:

1. **Local full-stack development** — developers should be able to run the entire stack (API, UI, Postgres, reverse proxy) with a single command
2. **Production hosting** — the platform needs to be deployable to a managed hosting provider
3. **Database migrations** — schema changes must be applied safely with role-based access control (superuser for migrations, restricted role for the app)
4. **Zero-downtime deploys** — migrations should be serialized across instances and non-breaking

## Decision

### Local: Docker Compose

A single `docker compose up --build` starts the full stack:

- **postgres** — PostgreSQL 16 with `init.sql` for initial role provisioning
- **migrate** — one-shot container that runs `scripts/migrate.ts` (provisions `modelguide_app` role, runs Drizzle migrations, grants privileges)
- **api** — Bun.js API server connecting as `modelguide_app` (restricted role)
- **ui** — TanStack Start UI server
- **caddy** — Reverse proxy on `:8080`, routing `/api/*`, `/docs*`, `/openapi.json`, `/mcp*` to API, everything else to UI

Service dependencies ensure correct startup order: postgres (healthy) → migrate (completed) → api (healthy) → ui, caddy.

### Production: Railway

Railway was chosen for production hosting:

- Native Docker support (uses our Dockerfiles directly)
- Managed PostgreSQL with volume snapshots
- Release commands for running migrations before deploy
- Environment variable management
- Simple scaling model

The release command (`bun run scripts/release.ts`) wraps the migration script with:
- PostgreSQL advisory lock to serialize concurrent deploys
- Migration count validation

### Database Role Separation

Two PostgreSQL roles maintain the principle of least privilege:

| Role | Used By | Capabilities |
|------|---------|-------------|
| `modelguide` | Migrations | CREATE/ALTER/DROP tables, manage roles |
| `modelguide_app` | API runtime | SELECT/INSERT/UPDATE/DELETE only |

The migration script (`scripts/migrate.ts`) idempotently provisions `modelguide_app` and grants privileges, making it safe for both fresh databases and existing ones.

### Multi-stage Docker Builds

Both API and UI use multi-stage builds for minimal image size:

- **API:** `deps` (prod install) → `build` (compile) → `runtime` (dist + prod node_modules)
- **UI:** `deps` (npm ci) → `build` (vite build) → `runtime` (.output only)

## Consequences

### Positive

- Single command (`make docker-up`) for full-stack local development
- Dockerfiles are shared between local and Railway (build once, deploy anywhere)
- Migration script is idempotent and safe to re-run
- Advisory locking prevents migration races in multi-instance deploys
- Role separation limits blast radius of application-level SQL injection

### Negative

- Docker Compose adds build time vs running services directly (mitigated by layer caching)
- Developers need Docker installed for full-stack mode (postgres-only mode still works via `make db-up`)

### Risks

- `ENCRYPTION_KEY` default in docker-compose is for local dev only — production must override via `.env.docker` or Railway env vars
