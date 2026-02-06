# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ModelGuide is an AI agent management platform that connects external AI agents (voice, chat) with service connectors (e-commerce, helpdesk, calendars). The platform provides:
- REST API for admin/support users to manage agents, connectors, and view analytics
- MCP (Model Context Protocol) server for AI agents to discover and execute tools
- Multitenancy via PostgreSQL Row-Level Security (RLS)

## Tech Stack

- **Runtime:** Bun.js
- **API Framework:** Hono with @hono/zod-openapi for typed routes
- **MCP Server:** @modelcontextprotocol/sdk
- **Database:** PostgreSQL 16 with Drizzle ORM
- **Documentation:** Scalar (@scalar/hono-api-reference)

## Commands

```bash
# Development
make install          # Install dependencies
make db-up            # Start PostgreSQL container (port 5434)
make dev              # Start dev server with hot reload (port 3000)

# Database
make db-generate      # Generate Drizzle migrations
make db-migrate       # Run migrations
make db-push          # Push schema changes (dev only)
make db-studio        # Open Drizzle Studio

# Production
make build            # Build for production
make start            # Run production build

# Utilities
make db-down          # Stop PostgreSQL
make reset            # Stop containers and remove volumes
make logs             # View container logs
```

## Architecture

### Directory Structure (Feature-Based)

```
modelguide-api/src/
├── index.ts              # Bun.serve entry point
├── app.ts                # Hono app, routes, OpenAPI/Scalar setup
├── env.ts                # Zod environment validation
├── db/                   # Drizzle client and schema
├── lib/                  # Shared utilities (createApp, createRouter)
├── types/                # Shared TypeScript types (AppBindings)
└── features/             # Feature modules
    ├── users/            # User management, auth (JWT, API keys)
    ├── organizations/    # Multitenancy, RLS context
    ├── agents/           # Agent CRUD, activation, API key generation
    ├── connectors/       # Connector catalog, instances, tools
    ├── secrets/          # Encrypted credentials storage
    ├── sessions/         # Session lifecycle, messages
    ├── feedback/         # Customer CSAT, support evaluations
    ├── analytics/        # Summary metrics, trends
    └── mcp/              # MCP server, resources, core tools
```

### Authentication Model

- **Admin/Support:** JWT tokens (organization derived from token claims)
- **Agents:** API keys (`mgk_xxx` prefix), key hash stored, shown only on creation

### Key Concepts

- **Connectors Catalog:** Read-only registry of connector types (Medusa, Zendesk, Calendly)
- **Connectors:** Org-specific instances with config referencing secrets by UUID
- **Tool Naming:** `{connector_slug}_{tool_name}` (e.g., `pizzapalace_add_to_cart`)
- **Core Tools:** Built-in platform tools (`core_create_session`, `core_end_session`, etc.)
- **requires_confirmation:** Tools that need user confirmation before execution

### API Endpoints

- `GET /api/health` - Health check
- `GET /openapi.json` - OpenAPI spec
- `GET /docs` - Scalar API documentation
- `POST /mcp` - MCP endpoint for AI agents

### Database

Schema defined in `docs/DB_SCHEMA.md`. Key tables:
- `organizations` - Multitenancy root
- `users` - Admin/Support users (not customers)
- `agents`, `api_keys` - AI agent configuration
- `connectors_catalog`, `connectors`, `connector_tools` - Connector system
- `secrets` - Encrypted credentials (polymorphic ownership)
- `sessions`, `session_messages`, `session_feedback` - Conversation tracking

## Path Aliases

Configured in tsconfig.json:
- `@features/*` → `./src/features/*`
- `@lib/*` → `./src/lib/*`
- `@db/*` → `./src/db/*`
- `@/*` → `./src/*`

---

## Dashboard UI (modelguide-ui)

Admin and support dashboard built with TanStack Start. Located in `modelguide-ui/`.

### UI Tech Stack

| Category | Technology |
|----------|------------|
| Framework | TanStack Start (SPA mode) |
| Runtime | React 19, TypeScript 5.7+ |
| Routing | TanStack Router (file-based) |
| Data Fetching | TanStack Query |
| State Management | Zustand with persist middleware |
| Styling | Tailwind CSS v4 |
| HTTP Client | ky |
| API Mocking | MSW (Mock Service Worker) |
| Charts | recharts |
| Component Variants | class-variance-authority (cva) |

### UI Commands

```bash
cd modelguide-ui
npm run dev           # Start dev server (port 3001)
npm run build         # Build for production
npm run typecheck     # TypeScript check
npm run lint          # Biome lint
npm run lint:fix      # Auto-fix lint issues
npm run test          # Run Vitest tests
```

### UI Directory Structure

```
modelguide-ui/src/
├── routes/                    # File-based routing (TanStack Router)
│   ├── __root.tsx             # Root layout with QueryClientProvider
│   ├── _authenticated.tsx     # Protected layout with auth check
│   ├── _authenticated/        # Protected routes
│   │   ├── index.tsx          # Dashboard
│   │   ├── sessions.tsx       # Sessions list
│   │   ├── sessions.$id.tsx   # Session detail
│   │   ├── agents.tsx         # Agents list
│   │   ├── agents.$id.tsx     # Agent detail
│   │   ├── agents.new.tsx     # Create agent
│   │   ├── connectors.tsx     # Connectors grid
│   │   ├── connectors.$id.tsx # Connector config
│   │   ├── secrets.tsx        # Secrets management
│   │   ├── analytics.tsx      # Analytics charts
│   │   └── settings.tsx       # User settings
│   └── login.tsx              # Login page
├── components/
│   ├── ui/                    # Reusable UI primitives
│   │   ├── button.tsx         # Primary/secondary/ghost/danger variants
│   │   ├── card.tsx           # Card, CardHeader, CardTitle, CardContent
│   │   ├── input.tsx          # Input with label, error, hint
│   │   ├── select.tsx         # Select dropdown
│   │   ├── badge.tsx          # Status badges with dot indicator
│   │   ├── avatar.tsx         # User avatar with initials fallback
│   │   ├── spinner.tsx        # Loading indicator
│   │   ├── dialog.tsx         # Modal wrapper
│   │   ├── pagination.tsx     # Pagination controls
│   │   ├── skeleton.tsx       # Loading placeholders
│   │   └── empty-state.tsx    # No data states
│   └── layout/
│       ├── logo.tsx           # {model: guide} branding
│       ├── sidebar.tsx        # Navigation with MAIN/ADMIN sections
│       ├── header.tsx         # Top bar with user menu
│       └── app-shell.tsx      # Sidebar + header + content
├── features/                  # Feature-specific components
│   ├── auth/components/       # Login form
│   ├── dashboard/components/  # Stats cards, recent sessions
│   ├── sessions/components/   # Sessions table, transcript, filters
│   ├── agents/components/     # Agents table, API key modal
│   ├── connectors/components/ # Connectors grid, config form
│   ├── secrets/components/    # Secrets table, forms
│   ├── analytics/components/  # Charts (trend, status, channel)
│   └── settings/components/   # Profile, appearance, users
├── stores/
│   ├── auth.ts                # Zustand auth store with persist
│   └── theme.ts               # Theme store (dark/light/system)
├── schemas/                   # Zod schemas for type safety
├── mocks/
│   ├── browser.ts             # MSW worker setup
│   ├── handlers/              # API mock handlers
│   └── data/                  # Mock data
├── lib/
│   ├── cn.ts                  # clsx + tailwind-merge utility
│   ├── utils.ts               # formatDuration, formatDate, etc.
│   └── api.ts                 # ky instance with auth headers
└── styles/
    └── app.css                # Tailwind config and design tokens
```

### UI Design System

**Design Direction: "Atmospheric Dark"** — Modern SaaS aesthetics with warm ember accents and depth.

**Typography:**
- Display: `--font-display: 'Syne'` — distinctive headings
- Body: `--font-sans: 'IBM Plex Sans'` — clean, readable
- Code: `--font-mono: 'JetBrains Mono'` — technical elements

**Color Tokens (defined in app.css):**
```css
/* Brand - Ember orange */
--color-brand-500: #f97316;

/* Dark mode backgrounds */
--color-bg-base: #0a0a0b;
--color-bg-elevated: #141416;
--color-bg-subtle: #1c1c1f;

/* Dark mode foregrounds */
--color-fg-primary: #fafafa;
--color-fg-secondary: #a8a8b3;
--color-fg-muted: #6b6b76;

/* Semantic */
--color-success: #10b981;
--color-warning: #f59e0b;
--color-error: #ef4444;
```

**Theme Support:**
- Dark mode (default) with atmospheric gradients
- Light mode with warm stone tones
- Toggle via header icon or Settings page

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

**Mock Credentials (dev only):**
- Admin: `admin@modelguide.ai` / `admin123`
- Support: `support@modelguide.ai` / `support123`

### UI Path Aliases

Configured in modelguide-ui/tsconfig.json:
- `~/` → `./src/`
