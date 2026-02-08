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

### Full Stack (Docker)

```bash
# Build and start everything (API + UI + Postgres + Caddy)
make docker-up
```

App runs at http://localhost:8080 (API + UI behind Caddy reverse proxy).

See `make docker-expose` for all exposed ports.

### Dev Mode (individual services)

```bash
# Start PostgreSQL
make db-up

# API dev server (port 3000)
make api-dev

# UI dev server (port 3001)
make ui-dev
```

## Tech Stack

**API:** Bun.js, Hono, Drizzle ORM, PostgreSQL, @modelcontextprotocol/sdk

**UI:** TanStack Start, React 19, Tailwind CSS v4, Zustand, Vitest

## API Endpoints

- `/api/health` - Health check
- `/docs` - API documentation
- `/mcp` - MCP endpoint for AI agents

## Deployment

### Docker Compose (local / staging)

```bash
make docker-up       # Build and start full stack
make docker-logs     # View logs
make docker-rebuild  # Rebuild API + UI only
make docker-down     # Stop all
make docker-reset    # Stop, remove volumes, rebuild
```

Override secrets for non-dev environments via `.env.docker`:

```bash
JWT_SECRET=...
REFRESH_JWT_SECRET=...
ENCRYPTION_KEY=...
MAGIC_LINK_SECRET=...
```

### Railway (production)

Architecture: PostgreSQL + API + UI + load balancer (Caddy). The LB is the only public-facing service — it routes `/api/*` and `/mcp` to the API and everything else to the UI via Railway's internal network.

Config-as-code via `railway.toml` in each service. Full setup guide: [`railway/DEPLOY.md`](railway/DEPLOY.md).

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/template/TEMPLATE_ID)

**Deploying changes:**

```bash
railway up --service api       # deploy API changes
railway up --service ui        # deploy UI changes
cd railway/lb && railway up --service lb && cd ../..  # deploy LB config changes
```

Only redeploy the service(s) you changed. The API runs `scripts/release.ts` (migrations) automatically on every deploy via `preDeployCommand` in `railway.toml`.

## Documentation

- [API Specification](docs/api-spec.md)
- [Database Schema](docs/DB_SCHEMA.md)
- [Product Requirements](docs/PRD.md)
- [UI Structure](docs/UI_STRUCTURE.md)
- [UI Implementation](docs/UI_IMPLEMENTATION.md)
- [Deployment Strategy (ADR)](docs/decisions/002-deployment-strategy.md)
