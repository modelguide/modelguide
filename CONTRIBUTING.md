# Contributing to ModelGuide

Thank you for your interest in contributing to ModelGuide! This guide covers everything you need to get started.

## How to Contribute

We follow the **fork & pull request** workflow — you don't need write access to this repo.

### 1. Fork & clone

```bash
# Fork via GitHub UI, then:
git clone https://github.com/<your-username>/modelguide.git
cd modelguide
git remote add upstream https://github.com/modelguide/modelguide.git
```

### 2. Create a branch

Always branch from an up-to-date `main`:

```bash
git fetch upstream
git checkout -b feat/my-feature upstream/main
```

Use descriptive branch names: `feat/zendesk-connector`, `fix/session-filter-bug`, `docs/setup-guide`.

### 3. Make your changes

See [First-Time Setup](#first-time-setup) below to get the project running locally. Follow the [Code Conventions](#code-conventions) section for style guidance.

### 4. Push & open a PR

```bash
git push origin feat/my-feature
```

Then open a pull request against `modelguide/modelguide:main` on GitHub. Fill in the PR template — describe **what** you changed and **why**.

### 5. Keeping your fork up to date

```bash
git fetch upstream
git rebase upstream/main
```

If your PR branch falls behind `main`, rebase before requesting review:

```bash
git checkout feat/my-feature
git rebase upstream/main
git push --force-with-lease origin feat/my-feature
```

### What happens next

- **CLA check** — if this is your first contribution, you'll be asked to sign our Contributor License Agreement (see [below](#contributor-license-agreement-cla)). It's a one-time, one-click process
- CI runs automatically (lint, typecheck, tests)
- A maintainer will approve CI to run on your fork
- A maintainer will review your PR — we aim to respond within a few business days
- We may suggest changes; push additional commits to the same branch
- Once approved, a maintainer will merge your PR

## First-Time Setup

### Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| [Docker](https://docs.docker.com/get-docker/) | 24+ | PostgreSQL container |
| [Bun](https://bun.sh) | 1.1+ | API runtime and package manager |
| [Node.js](https://nodejs.org) | 22+ | UI build tooling (TanStack Start) |
| [Git](https://git-scm.com) | 2.40+ | Version control |

### Quick start

```bash
# One-command setup: starts Postgres, installs deps, runs migrations + seed
make quickstart
```

Then in separate terminals:

```bash
make api-dev    # API at http://localhost:3000
make ui-dev     # Dashboard at http://localhost:3001
```

Open `http://localhost:3001`. Authentication uses **magic links** — enter your email, and the login link is printed to the API server console (no email provider needed in dev). Click the link to log in.

**Dev accounts (from seed data — GlowBox Beauty org):**
- **Admin:** `delivered+admin-glowbox@resend.dev`
- **Support:** `delivered+support-glowbox@resend.dev`
- **Viewer:** `delivered+viewer-glowbox@resend.dev`

The seed creates three organizations (GlowBox Beauty, ClearHealth, SteelPoint Supply) spanning retail, medical, and B2B verticals — each with Medusa + Zendesk connectors and ~300 sessions. See [Seed Data](docs/guide/seed-data.md) for all accounts, session scenarios, and the full org matrix.

API docs are auto-generated at `http://localhost:3000/docs`.

### Git hooks

We use [Lefthook](https://lefthook.dev/) for pre-commit and pre-push checks. Install it to catch lint and type errors before pushing:

```bash
lefthook install
```

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

### Running tests

```bash
make api-test              # All API tests (unit + integration)
make api-test-unit         # Unit tests only (no Docker needed)
make api-test-integration  # Integration tests (requires running Postgres)
make ui-test               # UI component tests
```

### Type checking & linting

```bash
make api-typecheck         # API TypeScript check
make ui-typecheck          # UI TypeScript check
make api-lint-check        # API lint (check only)
make ui-lint               # UI lint (Biome)
```

### All Make targets

Run `make help` to see every available command.

## Code Conventions

### Project structure

Both API and UI use **feature-based directories**. Related routes, services, schemas, and components live together — everything a feature needs is colocated:

```
modelguide/
├── modelguide-api/              # Hono API + MCP server
│   └── src/
│       ├── cli/                 # mg CLI — org provisioning tool
│       │   ├── commands/        # One file per command
│       │   ├── examples/acme/   # Sample YAML configs
│       │   ├── lib/             # IdRegistry, YAML loader, logger
│       │   └── schemas/         # Zod validation for YAML files
│       ├── features/
│       │   ├── agents/          # Agent CRUD, tool assignment
│       │   ├── compiler/        # Prompt compiler + voice strategies
│       │   ├── connectors/      # Connector config + catalog/
│       │   │   └── catalog/
│       │   │       ├── medusa/  # Medusa manifest + handlers
│       │   │       ├── zendesk/ # Zendesk manifest + handlers
│       │   │       ├── registry.ts
│       │   │       └── sync.ts
│       │   ├── mcp/             # MCP handler, core tools, schema conversion
│       │   ├── sops/            # SOP templates, definitions, agent assignment
│       │   ├── sessions/        # Session lifecycle, messages, feedback
│       │   ├── simulations/     # Personas, orchestrator, eval harness
│       │   ├── secrets/         # Encrypted credential storage
│       │   └── users/           # Auth, RBAC, user management
│       ├── db/                  # Drizzle schema, RLS, seed verticals
│       └── lib/                 # Middleware, crypto, errors, pagination
├── modelguide-ui/               # Dashboard (TanStack Start)
│   └── src/
│       ├── features/            # agents, connectors, sessions, analytics
│       ├── components/          # Primitives + layout
│       ├── routes/              # File-based routing
│       └── stores/              # Zustand (auth, theme)
├── examples/agents/             # Reference voice agents (LiveKit, Pipecat, ElevenLabs, Mastra)
├── docker/                      # PostgreSQL init (RLS roles)
├── docs/                        # Guides, ADRs, design system
├── railway/                     # Railway deployment configs + DEPLOY.md
└── Makefile                     # All dev commands
```

### File naming

- **kebab-case** for all files: `agent-form.tsx`, `auth.routes.ts`
- Routes: `name.tsx` or `name.$param.tsx` (TanStack Router convention)

### API path aliases

Configured in `modelguide-api/tsconfig.json`:

- `@features/*` → `./src/features/*`
- `@lib/*` → `./src/lib/*`
- `@db/*` → `./src/db/*`
- `@/*` → `./src/*`

### UI path alias

Configured in `modelguide-ui/tsconfig.json`:

- `~/` → `./src/`

### Typed routes (API)

All API routes use Hono + `@hono/zod-openapi` for request/response validation and automatic OpenAPI spec generation.

### UI component patterns

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

## Security

Found a vulnerability? **Do not open a public issue.** See [SECURITY.md](SECURITY.md) for responsible disclosure instructions.

## Contributor License Agreement (CLA)

We use a [Contributor License Agreement](https://en.wikipedia.org/wiki/Contributor_License_Agreement) to ensure contributions can be distributed under the project's license.

When you open your first pull request, the [CLA Assistant](https://cla-assistant.io/) bot will automatically comment with a link to sign the agreement. Just click the link, review the CLA, and accept — it takes seconds.

This is a one-time process — once signed, all your future PRs are covered. Your PR cannot be merged until the CLA is signed.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
