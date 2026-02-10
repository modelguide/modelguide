# ModelGuide Dashboard — UI Structure

## Overview

Admin and support dashboard for ModelGuide — an AI agent management platform. Built as a static SPA using TanStack Start.

---

## Design Direction: "Atmospheric Dark"

Modern SaaS aesthetics with warm ember accents and depth. The interface balances editorial precision with atmospheric richness — distinctive typography, layered backgrounds, and purposeful motion.

**Core principles:**
- **Distinctive typography** — Syne for display headings, IBM Plex Sans for body, JetBrains Mono for code/data
- **Atmospheric depth** — layered dark backgrounds with subtle radial gradients and noise textures
- **Warm ember accents** — orange brand color used surgically for focus, active states, and emphasis
- **Purposeful motion** — staggered reveals, breathing indicators, smooth transitions

**Avoid:**
- Generic shadcn/ui defaults without customization
- Overused fonts (Inter, Roboto, system-ui as primary)
- Purple/blue gradient backgrounds
- Rounded-everything pill shapes
- Cookie-cutter SaaS dashboard aesthetics

---

## Tech Stack

| Category | Technology |
|----------|------------|
| Framework | TanStack Start (SPA mode) |
| Runtime | React 19, TypeScript 5.7+ |
| Routing | TanStack Router (file-based) |
| Data Fetching | TanStack Query |
| Styling | Tailwind CSS v4 |
| HTTP Client | ky |
| Validation | Zod |
| Client State | Zustand |
| Icons | Lucide React |
| Motion | CSS animations + Framer Motion (selective) |
| Build | Vite 7 + Nitro |

---

## Typography

```css
@theme {
  /* Display headings — distinctive, editorial */
  --font-display: 'Syne', 'SF Pro Display', system-ui, sans-serif;

  /* Body text — warm, readable */
  --font-sans: 'IBM Plex Sans', system-ui, sans-serif;

  /* Code & data — technical, precise */
  --font-mono: 'JetBrains Mono', 'SF Mono', monospace;
}
```

| Element | Font | Size | Weight |
|---------|------|------|--------|
| Page titles | Syne (display) | 24px | 600 |
| Logo | JetBrains Mono | 16px | 500 |
| Navigation | IBM Plex Sans | 13px | 400 |
| Section headers | IBM Plex Sans | 11px uppercase | 500 |
| Body text | IBM Plex Sans | 14px | 400 |
| Data/metrics | JetBrains Mono | 32px | 500 |
| Table cells | JetBrains Mono | 13px | 400 |
| Timestamps | JetBrains Mono | 11px | 400 |

---

## Color System — "Ember on Obsidian"

### Dark Mode (Default)

```css
@theme {
  /* Backgrounds */
  --color-bg-base: #0a0a0b;        /* page background */
  --color-bg-elevated: #141416;    /* cards, sidebar */
  --color-bg-subtle: #1c1c1f;      /* hover, inputs */
  --color-bg-muted: #28282c;       /* disabled states */

  /* Foreground */
  --color-fg-primary: #fafafa;     /* primary text */
  --color-fg-secondary: #a8a8b3;   /* secondary text */
  --color-fg-muted: #6b6b76;       /* placeholders */
  --color-fg-subtle: #45454d;      /* borders, dividers */

  /* Brand — the ember (full scale) */
  --color-brand-500: #f97316;      /* primary orange */
  --color-brand-400: #fb923c;      /* hover state */
  --color-brand-600: #ea580c;      /* pressed state */
  --color-brand-950: #431407;      /* subtle backgrounds */

  /* Semantic */
  --color-success: #10b981;
  --color-success-muted: #064e3b;
  --color-warning: #f59e0b;
  --color-warning-muted: #451a03;
  --color-error: #ef4444;
  --color-error-muted: #450a0a;
  --color-info: #3b82f6;
  --color-info-muted: #1e3a5f;
}
```

### Light Mode

```css
@theme {
  /* Backgrounds */
  --color-bg-base: #fafaf9;        /* warm off-white */
  --color-bg-elevated: #ffffff;
  --color-bg-subtle: #f5f5f4;
  --color-bg-muted: #e7e5e4;

  /* Foreground */
  --color-fg-primary: #1c1917;     /* charcoal */
  --color-fg-secondary: #57534e;
  --color-fg-muted: #a8a29e;
  --color-fg-subtle: #d6d3d1;
}
```

---

## Spacing & Layout

```css
@theme {
  --sidebar-width: 240px;
  --sidebar-collapsed: 64px;
  --header-height: 56px;
  --page-padding: 24px;
  --content-max-width: 1152px;

  /* Consistent spacing scale */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-6: 24px;
  --space-8: 32px;
  --space-12: 48px;
}
```

### Layout Grid

```
┌─────────────────────────────────────────────────────────────────┐
│ ┌──────────┐ ┌────────────────────────────────────────────────┐ │
│ │ SIDEBAR  │ │ HEADER                                         │ │
│ │ 240px    │ │ 56px height                                    │ │
│ │          │ ├────────────────────────────────────────────────┤ │
│ │ logo     │ │                                                │ │
│ │ ──────── │ │ CONTENT                                        │ │
│ │ nav      │ │ max-width: 1152px                              │ │
│ │          │ │ padding: 24px                                  │ │
│ │          │ │                                                │ │
│ │ ──────── │ │                                                │ │
│ │ user     │ │                                                │ │
│ └──────────┘ └────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

---

## Motion & Animation

### Philosophy
- **Page load:** Staggered fade-up, 30ms delays between elements
- **Route transitions:** Subtle crossfade, 150ms
- **Hover states:** 100ms ease-out, never jarring
- **Active indicators:** Subtle pulse/glow for live data

### Core Animations

```css
/* Staggered entrance */
@keyframes fade-up {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}

/* Active/live indicator pulse */
@keyframes pulse-glow {
  0%, 100% { box-shadow: 0 0 0 0 var(--color-brand-glow); }
  50% { box-shadow: 0 0 12px 4px var(--color-brand-glow); }
}

/* Subtle breathing for active sessions */
@keyframes breathe {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.7; }
}
```

### Transition Defaults

```css
/* Standard transition */
transition: all 150ms ease-out;

/* Hover states */
transition: background-color 100ms ease-out,
            border-color 100ms ease-out,
            box-shadow 150ms ease-out;
```

---

## Component Patterns

### Sidebar Navigation

```
┌─────────────────────┐
│  {model: guide}     │  ← Logo, JetBrains Mono
├─────────────────────┤
│  MAIN               │  ← Section label, 11px uppercase
│  ▌ Dashboard        │  ← Active: orange left border
│    Sessions         │
│    Analytics        │
├─────────────────────┤
│  ADMIN              │
│    Agents           │
│    Connectors       │
│    Secrets          │
├─────────────────────┤
│  ○ Alex Admin       │  ← Avatar + name
│    admin            │  ← Role badge
└─────────────────────┘
```

**Active state:** 2px orange left border, subtle orange background tint
**Hover state:** Background shifts to --color-bg-subtle

### Data Tables

- No zebra striping
- Subtle bottom border on rows (--color-fg-subtle)
- Hover: row background + subtle glow
- Selected: orange left border accent
- Monospace for data columns (IDs, timestamps, metrics)

### Stat Cards

```
┌─────────────────────────────┐
│  Total Sessions             │  ← Label, 12px muted
│  1,234                      │  ← Value, 32px mono
│  ▲ 12% from last week       │  ← Trend, 11px green/red
└─────────────────────────────┘
```

### Session Transcript (Terminal Style)

Instead of chat bubbles, use log format:

```
┌─────────────────────────────────────────────────────────────┐
│ [10:00:15] USER     I'd like to order a large pepperoni     │
│ [10:00:17] AGENT    I've added that to your cart.           │
│ [10:00:17] TOOL     pizzapalace_add_to_cart → success 150ms │
│ [10:00:18] AGENT    Would you like anything else?           │
└─────────────────────────────────────────────────────────────┘
```

### Tool Call Block

```
┌─ pizzapalace_add_to_cart ──────────────────────┐
│  ► item: "large pepperoni"                     │
│  ► quantity: 1                                 │
├────────────────────────────────────────────────┤
│  ◄ cart_id: "cart_123"                         │
│  ◄ subtotal: $18.99                            │
└──────────────────────────────────── 150ms ─────┘
```

### Status Badges

```css
/* Pill badges with semantic colors */
.badge-active    { background: var(--color-success-muted); color: var(--color-success); }
.badge-completed { background: var(--color-bg-subtle); color: var(--color-fg-secondary); }
.badge-abandoned { background: var(--color-error-muted); color: var(--color-error); }
```

---

## Project Structure

```
modelguide-ui/
├── public/
├── src/
│   ├── components/
│   │   ├── ui/                 # Base components
│   │   │   ├── button.tsx
│   │   │   ├── card.tsx
│   │   │   ├── input.tsx
│   │   │   ├── badge.tsx
│   │   │   ├── avatar.tsx
│   │   │   └── ...
│   │   └── layout/
│   │       ├── app-shell.tsx
│   │       ├── sidebar.tsx
│   │       ├── header.tsx
│   │       └── page-container.tsx
│   ├── features/
│   │   ├── auth/
│   │   ├── dashboard/
│   │   ├── sessions/
│   │   ├── agents/
│   │   ├── connectors/
│   │   ├── secrets/
│   │   ├── analytics/
│   │   └── settings/
│   ├── hooks/
│   ├── lib/
│   │   ├── cn.ts              # Class merge utility
│   │   └── utils.ts
│   ├── mocks/
│   ├── routes/
│   ├── schemas/
│   ├── stores/
│   └── styles/
│       └── app.css
├── biome.json
├── package.json
├── tsconfig.json
└── vite.config.ts
```

---

## Route Structure

| Route | Page | Access |
|-------|------|--------|
| `/login` | Login | Public |
| `/` | Dashboard | Auth |
| `/sessions` | Sessions list | Auth |
| `/sessions/:id` | Session detail | Auth |
| `/agents` | Agents list | Admin |
| `/agents/:id` | Agent detail | Admin |
| `/connectors` | Connectors | Admin |
| `/connectors/:id` | Connector config | Admin |
| `/secrets` | Secrets | Admin |
| `/analytics` | Analytics | Auth |
| `/settings` | Settings | Auth |

---

## Implementation Status

**Current:** Phase 0 Complete (Scaffolding)

See `modelguide-ui/README.md` for quick start and directory overview.

---

## Quick Start

```bash
cd modelguide-ui
npm install
npm run dev
```

App runs at http://localhost:3001
