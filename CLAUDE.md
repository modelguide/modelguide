# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Project Overview

ModelGuide is an AI agent management platform that connects external AI agents (voice, chat) with service connectors (e-commerce, helpdesk, calendars). REST API for admin/support users, MCP server for AI agents, multitenancy via PostgreSQL RLS.

## Documentation Index

- `README.md` — Project overview, architecture, quick start, roadmap
- `CONTRIBUTING.md` — Setup, environment variables, dev workflow, code conventions
- `docs/PRD.md` — Product requirements, personas, use cases, permissions matrix
- `docs/api-spec.md` — Complete REST API and MCP specification
- `docs/DB_SCHEMA.md` — Database schema
- `docs/guide/getting-started.md` — Agent developer quickstart (MCP integration)
- `docs/guide/admin-setup.md` — Platform admin configuration guide
- `docs/UI_STRUCTURE.md` — Dashboard design system and component patterns
- `docs/decisions/001-refresh-token-rotation.md` — Token architecture, cookie config, CSRF
- `docs/decisions/002-magic-link-authentication.md` — Passwordless auth, delivery strategies
- `modelguide-api/README.md` — API package details
- `modelguide-ui/README.md` — Dashboard package details
- `Makefile` — All dev commands (`make help` for full list)

## Local Workspace

`.claude/local/` is a git-ignored directory for session artifacts — plans, research notes, scratch files. Do not commit its contents.

## Architecture Decision Records

Create ADRs in `docs/decisions/` for significant decisions:

- **When:** New patterns, security model changes, technology choices, non-obvious tradeoffs
- **Format:** `NNN-short-title.md` (e.g., `001-refresh-token-rotation.md`)
- **Sections:** Status, Context, Decision (with rationale), Consequences

## Authentication Model

- **Admin/Support:** Short-lived JWT access tokens (15 min) + refresh token rotation via httpOnly cookie (7-day sliding, `__Host-` prefix on HTTPS). Refresh uses `REFRESH_JWT_SECRET` (separate from `JWT_SECRET`). CSRF protection via Origin header. See `docs/decisions/001-refresh-token-rotation.md`.
- **Agents:** API keys (`mgk_xxx` prefix), SHA-256 hash stored, shown only on creation.

## Key Concepts

- **Connectors Catalog:** Read-only registry of connector types (Medusa, Zendesk, Calendly)
- **Connectors:** Org-specific instances with config referencing secrets by UUID
- **Tool Naming:** `{connector_slug}_{tool_name}` (e.g., `pizzapalace_add_to_cart`)
- **Core Tools:** Built-in platform tools (`core_create_session`, `core_end_session`, etc.)
- **requires_confirmation:** Tools that need user confirmation before execution

## Path Aliases

**API** (`modelguide-api/tsconfig.json`):
- `@features/*` → `./src/features/*`
- `@lib/*` → `./src/lib/*`
- `@db/*` → `./src/db/*`
- `@/*` → `./src/*`

**UI** (`modelguide-ui/tsconfig.json`):
- `~/` → `./src/`

---

## Dashboard UI (modelguide-ui)

### Design System: "Atmospheric Dark"

**Typography:**
- Display: `--font-display: 'Syne'` — distinctive headings
- Body: `--font-sans: 'IBM Plex Sans'` — clean, readable
- Code: `--font-mono: 'JetBrains Mono'` — technical elements

**Color Tokens (defined in app.css):**
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

**Theme:** Dark mode (default) with atmospheric gradients. Light mode with warm stone tones.

### UI Development Patterns

**Component Variants with CVA:**
```tsx
import { cva, type VariantProps } from 'class-variance-authority'

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
- Admin: `delivered+admin-pizza-palace@resend.dev`
- Support: `delivered+support-pizza-palace@resend.dev`
