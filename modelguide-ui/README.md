# ModelGuide Dashboard

Admin and support dashboard for the ModelGuide platform. Built as a static SPA with TanStack Start.

## Tech Stack

| Category | Technology |
|----------|------------|
| Framework | TanStack Start (SPA mode) |
| Runtime | React 19, TypeScript 5.7+ |
| Routing | TanStack Router (file-based) |
| Data Fetching | TanStack Query |
| State Management | Zustand with persist middleware |
| Styling | Tailwind CSS v4 |
| HTTP Client | ky |
| Charts | recharts |
| Component Variants | class-variance-authority (cva) |

## Quick Start

```bash
cd modelguide-ui
npm install
npm run dev
```

Dashboard runs at **http://localhost:3001**.

Or from the repo root:

```bash
make ui-install
make ui-dev
```

**Dev accounts (seed data):** Authentication uses magic links — enter your email and the login link is printed to the API console.

- Admin: `delivered+admin-glowbox@resend.dev`
- Support: `delivered+support-glowbox@resend.dev`
- Viewer: `delivered+viewer-glowbox@resend.dev`

## Directory Structure

```
src/
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
│   ├── ui/                    # Reusable UI primitives (button, card, input, badge, etc.)
│   └── layout/                # App shell, sidebar, header
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
├── lib/
│   ├── cn.ts                  # clsx + tailwind-merge utility
│   ├── utils.ts               # formatDuration, formatDate, etc.
│   └── api.ts                 # ky instance with auth headers
└── styles/
    └── app.css                # Tailwind config and design tokens
```

## Design System

**"Atmospheric Dark"** — Modern SaaS aesthetics with warm ember accents and depth.

- **Display font:** Syne — distinctive headings
- **Body font:** IBM Plex Sans — clean, readable
- **Code font:** JetBrains Mono — technical elements
- **Brand color:** `#f97316` (ember orange)

Dark mode is the default. Light mode uses warm stone tones. See `docs/UI_STRUCTURE.md` for full design tokens, color system, and component patterns.

## Scripts

```bash
npm run dev           # Start dev server (port 3001)
npm run build         # Build for production
npm run typecheck     # TypeScript check
npm run lint          # Biome lint (check only)
npm run lint:fix      # Auto-fix lint issues
npm run test          # Run Vitest tests
```

## Path Alias

Configured in `tsconfig.json`:

- `~/` → `./src/`

## Related Docs

- [UI Structure & Design Tokens](../docs/UI_STRUCTURE.md)
- [Root README](../README.md)
