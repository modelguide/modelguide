# Contributing to ModelGuide

Thank you for your interest in contributing to ModelGuide! This guide covers everything you need to get started.

## Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| [Docker](https://docs.docker.com/get-docker/) | 24+ | PostgreSQL container |
| [Bun](https://bun.sh) | 1.1+ | API runtime and package manager |
| [Node.js](https://nodejs.org) | 22+ | UI build tooling (TanStack Start) |
| [Git](https://git-scm.com) | 2.40+ | Version control |

## First-Time Setup

```bash
# Clone the repository
git clone https://github.com/modelguide/modelguide.git
cd modelguide

# One-command setup: starts Postgres, installs deps, runs migrations + seed
make quickstart
```

Then in separate terminals:

```bash
make api-dev    # API at http://localhost:3000
make ui-dev     # Dashboard at http://localhost:3001
```

Open `http://localhost:3001`. Authentication uses **magic links** — enter your email, and the login link is printed to the API server console (no email provider needed in dev). Click the link to log in.

**Dev accounts (from seed data):**
- **Admin:** `delivered+admin-pizza-palace@resend.dev`
- **Support:** `delivered+support-pizza-palace@resend.dev`

API docs are auto-generated at `http://localhost:3000/docs`.

## Environment Variables

Both sub-projects require `.env` files. The `make quickstart` command copies `.env.example` automatically for each.

### API (`modelguide-api/.env`)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `3000` | API server port |
| `NODE_ENV` | No | `development` | Environment mode |
| `DATABASE_URL` | Yes | (see .env.example) | PostgreSQL connection string |
| `MCP_SERVER_NAME` | No | `ModelGuide MCP` | MCP server name in protocol handshake |
| `MCP_SERVER_VERSION` | No | `1.0.0` | MCP server version |
| `JWT_SECRET` | Yes | — | Access token signing secret (min 32 chars) |
| `JWT_EXPIRES_IN` | No | `15m` | Access token lifetime |
| `REFRESH_JWT_SECRET` | Yes | — | Refresh token signing secret (must differ from `JWT_SECRET`) |
| `REFRESH_TOKEN_EXPIRES_IN` | No | `7d` | Refresh token lifetime |
| `REFRESH_SESSION_RETENTION_DAYS` | No | `90` | Days to keep expired refresh sessions in DB |
| `ENCRYPTION_KEY` | Yes | — | AES-256-GCM key for secrets storage (base64, 32 bytes) |
| `APP_URL` | Yes | `http://localhost:3000` | Frontend origin for CSRF validation |
| `MAGIC_LINK_SECRET` | Yes | — | HMAC secret for hashing magic tokens (min 32 chars) |
| `MAGIC_LINK_EXPIRES_IN_MINUTES` | No | `15` | Magic link expiration |
| `MAGIC_LINK_STRATEGY` | No | `console` | Delivery strategy: `console` (dev) or `resend` (production) |
| `RESEND_API_KEY` | If resend | — | [Resend](https://resend.com) API key (only when strategy is `resend`) |
| `RESEND_FROM_EMAIL` | If resend | — | Sender email address (only when strategy is `resend`) |
| `API_EXTERNAL_ADDRESS` | No | (falls back to `APP_URL`) | Public-facing API URL for external services (e.g., ElevenLabs webhooks, MCP endpoints) |

### UI (`modelguide-ui/.env`)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `VITE_API_URL` | No | `http://localhost:8000/api` | API base URL (when not using Vite proxy) |
| `VITE_ENABLE_DEVTOOLS` | No | `true` | Enable React/TanStack devtools |

### Generating secrets

```bash
# JWT and magic link secrets
openssl rand -hex 32

# Encryption key (base64-encoded 32 bytes)
openssl rand -base64 32
```

## Development Workflow

### Branching

1. Fork the repo and create a branch from `main`
2. Use descriptive branch names: `feat/zendesk-connector`, `fix/session-filter-bug`
3. Keep PRs focused — one feature or fix per PR

### Running Tests

```bash
make api-test              # All API tests (unit + integration)
make api-test-unit         # Unit tests only (no Docker needed)
make api-test-integration  # Integration tests (requires running Postgres)
make ui-test               # UI component tests
```

### Type Checking & Linting

```bash
make api-typecheck         # API TypeScript check
make ui-typecheck          # UI TypeScript check
make api-lint-check        # API lint (check only)
make ui-lint               # UI lint (Biome)
```

### All Make Targets

Run `make help` to see every available command.

## Code Conventions

### Project Structure

Both API and UI use **feature-based directories**. Related routes, services, schemas, and components live together:

```
src/features/
├── agents/          # Routes, service, schemas, tests
├── connectors/      # Routes, service, catalog/
├── sessions/        # Routes, service, schemas
└── ...
```

### File Naming

- **kebab-case** for all files: `agent-form.tsx`, `auth.routes.ts`
- Routes: `name.tsx` or `name.$param.tsx` (TanStack Router convention)

### API Path Aliases

Configured in `modelguide-api/tsconfig.json`:

- `@features/*` → `./src/features/*`
- `@lib/*` → `./src/lib/*`
- `@db/*` → `./src/db/*`
- `@/*` → `./src/*`

### UI Path Alias

Configured in `modelguide-ui/tsconfig.json`:

- `~/` → `./src/`

### Typed Routes (API)

All API routes use Hono + `@hono/zod-openapi` for request/response validation and automatic OpenAPI spec generation.

### UI Component Patterns

- **CVA** (class-variance-authority) for component variants
- **TanStack Query** for data fetching
- **Zustand** for client state (auth, theme)
- **Zod** schemas for form validation

## Database Changes

1. Edit the Drizzle schema in `modelguide-api/src/db/schema/`
2. Generate a migration with a descriptive name:
   ```bash
   cd modelguide-api
   bunx drizzle-kit generate --name add-agent-description-field
   ```
3. Run the migration:
   ```bash
   make db-migrate
   ```
4. If the change is significant, consider creating an ADR (see below)

## Adding an API Route

1. Create or update files in the appropriate `src/features/<feature>/` directory
2. Define the route with `@hono/zod-openapi` (request schema, response schema, handler)
3. Register the route in `src/app.ts`
4. Add tests in `tests/unit/` and/or `tests/integration/`

## Architecture Decision Records

For significant design decisions, create an ADR in `docs/decisions/`:

- **When:** New patterns, security model changes, technology choices, non-obvious tradeoffs
- **Format:** `NNN-short-title.md` (e.g., `001-refresh-token-rotation.md`)
- **Sections:** Status, Context, Decision (with rationale), Consequences (positive, negative, risks)

Don't create ADRs for routine feature work — only for decisions where "why" matters to future contributors.

## Submitting a Pull Request

1. Ensure all checks pass:
   ```bash
   make api-test && make ui-test
   make api-typecheck && make ui-typecheck
   make api-lint-check && make ui-lint
   ```
2. Write a clear PR description explaining **what** and **why**
3. Link any related issues
4. Request review

Check [open issues](https://github.com/modelguide/modelguide/issues) for `good first issue` labels if you're looking for a place to start.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
