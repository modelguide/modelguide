# ModelGuide

AI agent management platform connecting external AI agents with service connectors via MCP.

## Project Structure

```
modelguide/
├── modelguide-api/    # Backend API (Hono + MCP)
├── modelguide-ui/     # Dashboard UI (TanStack Start)
└── docs/              # Documentation
```

## Quick Start

### API Server

```bash
# Install dependencies
make install

# Start PostgreSQL
make db-up

# Run dev server
make dev
```

API runs at http://localhost:3000

### Dashboard UI

```bash
cd modelguide-ui
npm install
npm run dev
```

Dashboard runs at http://localhost:3001

## Tech Stack

**API:** Bun.js, Hono, Drizzle ORM, PostgreSQL, @modelcontextprotocol/sdk

**UI:** TanStack Start, React 19, Tailwind CSS v4, Zustand, Vitest

## API Endpoints

- `/api/health` - Health check
- `/docs` - API documentation
- `/mcp` - MCP endpoint for AI agents

## Documentation

- [API Specification](docs/api-spec.md)
- [Database Schema](docs/DB_SCHEMA.md)
- [Product Requirements](docs/PRD.md)
- [UI Structure](docs/UI_STRUCTURE.md)
- [UI Implementation](docs/UI_IMPLEMENTATION.md)
