# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Project Overview

ModelGuide is an AI agent management platform that connects external AI agents (voice, chat) with service connectors (e-commerce, helpdesk, calendars). REST API for admin/support users, MCP server for AI agents, multitenancy via PostgreSQL RLS.

## Documentation

- `README.md` — Project overview, architecture, quick start, roadmap
- `CONTRIBUTING.md` — Setup, environment variables, dev workflow, code conventions
- `docs/guide/mcp-integration.md` — Agent developer MCP integration guide
- `docs/guide/admin-guide.md` — Platform admin configuration guide
- `docs/UI_STRUCTURE.md` — Dashboard design system and component patterns
- `docs/decisions/` — Architecture Decision Records (ADR-001 through ADR-005)
- `Makefile` — All dev commands (`make help` for full list, `make quickstart` for first-time setup)

## Local Workspace

`.claude/local/` is a git-ignored directory for session artifacts — plans, research notes, scratch files. Do not commit its contents.

## Architecture Decision Records

Create ADRs in `docs/decisions/` for significant decisions:

- **When:** New patterns, security model changes, technology choices, non-obvious tradeoffs
- **Format:** `NNN-short-title.md` (e.g., `001-refresh-token-rotation.md`)
- **Sections:** Status, Context, Decision (with rationale), Consequences

## Environment Variables

Env vars are validated in `modelguide-api/src/env.ts` (Zod). When adding or renaming a variable, also update `railway/DEPLOY.md` (steps 3 and 8 list the production vars).

## Commands

```bash
# First-time setup (starts Postgres, installs deps, runs migrations + seed)
make quickstart

# API
make api-dev                  # Start API dev server (port 3000)
make api-test                 # Run all API tests
make api-test-unit            # Unit tests only (no Docker needed)
make api-test-integration     # Integration tests (requires running Postgres)
make api-typecheck            # TypeScript type checking
make api-lint                 # Lint with auto-fix
make api-lint-check           # Lint check only (CI uses this)

# UI
make ui-dev                   # Start UI dev server (port 3001)
make ui-test                  # Run UI tests
make ui-typecheck             # TypeScript type checking
make ui-lint                  # Biome lint

# Database
make db-up                    # Start PostgreSQL container (port 5434)
make db-down                  # Stop PostgreSQL container
make db-generate              # Generate Drizzle migrations (use: drizzle-kit generate --name <descriptive-name>)
make db-migrate               # Run migrations
make db-seed                  # Seed database with test data
make db-studio                # Open Drizzle Studio
```

## API Architecture

**Tech stack:** Bun.js, Hono + @hono/zod-openapi, @modelcontextprotocol/sdk, PostgreSQL 16 + Drizzle ORM, Scalar docs

```
modelguide-api/src/
├── index.ts              # Bun.serve entry point
├── app.ts                # Hono app, routes, OpenAPI/Scalar setup
├── env.ts                # Zod environment validation
├── db/                   # Drizzle client and schema
├── lib/                  # Shared utilities, middleware, crypto, JWT
└── features/
    ├── users/            # Auth (magic links, JWT, refresh tokens, API keys)
    ├── organizations/    # Multitenancy, RLS context
    ├── agents/           # Agent CRUD, activation, API key generation
    ├── connectors/       # Connector catalog, instances, tools
    ├── secrets/          # Encrypted credentials (AES-256-GCM)
    ├── sops/             # SOP templates, definitions, agent assignments
    ├── sessions/         # Session lifecycle, messages
    ├── feedback/         # Customer CSAT, support evaluations
    ├── analytics/        # Summary metrics, trends
    └── mcp/              # MCP server, resources, core tools
```

**Key endpoints:** `POST /mcp` (AI agents), `GET /docs` (Scalar), `GET /api/health`

**Path aliases** (`modelguide-api/tsconfig.json`):
- `@features/*` → `./src/features/*`
- `@lib/*` → `./src/lib/*`
- `@db/*` → `./src/db/*`
- `@/*` → `./src/*`

### Authentication Model

- **Dashboard users:** Magic link passwordless login. Short-lived JWT access tokens (15 min, memory-only). Refresh token rotation via httpOnly cookie (`__Host-` prefix on HTTPS, plain `refresh_token` on HTTP). CSRF protection via Origin header on `/auth/refresh` and `/auth/logout`. See ADR-001 and ADR-002.
- **AI agents:** API keys (`mgk_xxx` prefix), SHA-256 hashed before storage, shown only once at creation.

### Key Concepts

- **Connectors Catalog:** Read-only registry of connector types (Medusa + Zendesk shipped)
- **Connectors:** Org-specific instances with config referencing secrets by UUID
- **Tool Naming:** `{connector_slug}_{tool_name}` (e.g., `glowbox_store_add_to_cart`)
- **Core Tools:** Built-in platform tools (`core_add_messages`)
- **requires_confirmation:** Tools that need user confirmation before execution
- **SOP Templates:** Global catalog of reusable SOP blueprints (like `connectors_catalog` for connectors)
- **SOPs:** Org-scoped definitions forked from templates or created from scratch. Draft/active/archived lifecycle. Steps stored relationally in `sop_steps`
- **Agent SOPs:** Many-to-many via `agent_sops` junction table (same pattern as `agent_connector_tools`)

### Database

Key tables: `organizations`, `users`, `agents`, `api_keys`, `connectors_catalog`, `connectors`, `connector_tools`, `secrets`, `sessions`, `session_messages`, `session_feedback`, `magic_tokens`, `security_tokens`, `sop_templates`, `sops`, `sop_steps`, `agent_sops`. Schema defined in `modelguide-api/src/db/schema/`.

---

## Dashboard UI (modelguide-ui)

**Tech stack:** TanStack Start (SPA mode), React 19, TanStack Router + Query, Zustand, Tailwind CSS v4, ky, recharts, CVA

```
modelguide-ui/src/
├── routes/               # File-based routing (TanStack Router)
├── components/
│   ├── ui/               # Reusable primitives (button, card, input, badge, dialog, etc.)
│   └── layout/           # App shell, sidebar, header, logo
├── features/             # Feature-specific components per domain
│   ├── auth/             # Login form (magic link)
│   ├── dashboard/        # Stats cards, recent sessions
│   ├── sessions/         # Sessions table, transcript viewer, filters
│   ├── agents/           # Agents table, API key modal
│   ├── connectors/       # Connectors grid, config form
│   ├── secrets/          # Secrets table, forms
│   ├── analytics/        # Charts (trend, status, channel)
│   └── settings/         # Profile, appearance, users
├── stores/               # Zustand (auth with persist, theme)
├── schemas/              # Zod schemas
├── lib/                  # cn.ts, utils.ts, api.ts (ky instance)
└── styles/app.css        # Tailwind config and design tokens
```

**Path alias** (`modelguide-ui/tsconfig.json`): `~/` → `./src/`

### Design System: "Atmospheric Dark"

**Typography:** Syne (display), IBM Plex Sans (body), JetBrains Mono (code)

**Color Tokens (app.css):**
```css
--color-brand-500: #f97316;       /* Brand ember orange */
--color-bg-base: #0a0a0b;        /* Dark mode page background */
--color-bg-elevated: #141416;    /* Cards, sidebar */
--color-bg-subtle: #1c1c1f;      /* Hover, inputs */
--color-fg-primary: #fafafa;     /* Primary text */
--color-fg-secondary: #a8a8b3;   /* Secondary text */
--color-fg-muted: #6b6b76;       /* Placeholders */
--color-success: #10b981;
--color-warning: #f59e0b;
--color-error: #ef4444;
```

### UI Development Patterns

**Component Variants with CVA:**
```tsx
const buttonVariants = cva('base-classes', {
  variants: {
    variant: { primary: '...', secondary: '...' },
    size: { sm: '...', md: '...' },
  },
  defaultVariants: { variant: 'primary', size: 'md' },
})
```

**Data Fetching with TanStack Query:**
```tsx
const { data, isLoading } = useQuery({
  queryKey: ['agents'],
  queryFn: () => api.get('agents').json<AgentListResponse>(),
})
```

**Route Protection:**
```tsx
export const Route = createFileRoute('/_authenticated')({
  beforeLoad: async ({ location }) => {
    const { isAuthenticated } = useAuthStore.getState()
    if (!isAuthenticated) {
      throw redirect({ to: '/login', search: { redirect: location.pathname } })
    }
  },
})
```

**Dev Accounts (seed data — magic link auth, link printed to API console):**
- Admin: `delivered+admin-glowbox@resend.dev`
- Support: `delivered+support-glowbox@resend.dev`
- Viewer: `delivered+viewer-glowbox@resend.dev`
