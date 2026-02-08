# ModelGuide Dashboard

Admin and support dashboard for the ModelGuide platform.

## Tech Stack

- **Framework:** TanStack Start (SPA mode)
- **React 19** + **TypeScript 5.7+**
- **Routing:** TanStack Router (file-based)
- **Styling:** Tailwind CSS v4
- **Build:** Vite 7 + Nitro

## Quick Start

```bash
cd dashboard
npm install
npm run dev
```

App runs at http://localhost:3000

## Project Structure

```
src/
├── routes/           # File-based routes
│   ├── __root.tsx    # Root layout
│   └── index.tsx     # Home page
├── components/       # UI components (Phase 1+)
├── features/         # Feature modules (Phase 2+)
├── lib/              # Utilities
├── styles/           # CSS
└── router.tsx        # Router config
```

## Scripts

- `npm run dev` - Start dev server
- `npm run msw:init` - Generate MSW worker (run once after clone if dev mocking fails)
- `npm run build` - Production build
- `npm run lint` - Run Biome linter
- `npm run typecheck` - TypeScript check

## Implementation Status

See `docs/UI_STRUCTURE.md` for architecture and design tokens.
See `docs/UI_IMPLEMENTATION.md` for phase-by-phase tasks.

**Current:** Phase 0 - Scaffolding complete
