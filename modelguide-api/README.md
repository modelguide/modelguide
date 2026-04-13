# ModelGuide API

REST API and MCP server for the ModelGuide platform. Built with Hono on Bun.js.

## What This Is

- **REST API** for admin and support users to manage agents, connectors, secrets, sessions, and analytics
- **MCP server** for external AI agents to discover and execute tools via [Model Context Protocol](https://modelcontextprotocol.io) (Streamable HTTP transport)
- **Multi-tenant** with PostgreSQL Row-Level Security isolating organizations at the database level

## Quick Start

```bash
cd modelguide-api
cp .env.example .env      # Configure environment variables
bun install
```

Or from the repo root:

```bash
make quickstart           # Full setup including Postgres, migrations, seed
make api-dev              # Start dev server at http://localhost:3000
```

API docs are auto-generated at `http://localhost:3000/docs` (Scalar UI).

## Architecture

### Feature-Based Structure

```
src/
├── index.ts              # Bun.serve entry point
├── app.ts                # Hono app, route registration, OpenAPI/Scalar setup
├── env.ts                # Zod environment validation
├── db/                   # Drizzle client, schema definitions, migrations, seeds
├── lib/                  # Shared utilities: middleware, crypto, errors, pagination
├── types/                # Shared TypeScript types (AppBindings)
└── features/
    ├── users/            # Auth (magic links, JWT, refresh tokens), user management
    ├── organizations/    # Multi-tenancy, RLS context
    ├── agents/           # Agent CRUD, activation, API key generation
    ├── connectors/       # Connector catalog, instances, tool assignment
    │   └── catalog/      # Code-defined connector manifests (Medusa, etc.)
    ├── secrets/          # AES-256-GCM encrypted credential storage
    ├── sops/             # SOP templates, definitions, agent assignments
    ├── sessions/         # Session lifecycle, messages
    ├── feedback/         # Customer CSAT, support evaluations
    ├── analytics/        # Summary metrics, trends
    └── mcp/              # MCP server, core tools, schema conversion
```

### Authentication

- **Dashboard users:** Magic link login → short-lived JWT (15 min) + refresh token rotation via httpOnly cookie. See [ADR-001](../docs/decisions/001-refresh-token-rotation.md).
- **AI agents:** API keys (`mgk_` prefix), SHA-256 hashed, shown only on creation.

### Key Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/health` | Health check |
| `GET /docs` | Scalar API documentation |
| `GET /openapi.json` | OpenAPI 3.1 spec |
| `/mcp/:agentId` | MCP endpoint for a specific agent (Streamable HTTP transport) |

Full specification auto-generated at `http://localhost:3000/docs` (Scalar UI).

## Path Aliases

Configured in `tsconfig.json`:

| Alias | Path |
|-------|------|
| `@features/*` | `./src/features/*` |
| `@lib/*` | `./src/lib/*` |
| `@db/*` | `./src/db/*` |
| `@/*` | `./src/*` |

## Testing

```bash
bun test                  # All tests
bun run test:unit         # Unit tests (no external deps)
bun run test:integration  # Integration tests (requires running Postgres)
```

**Unit tests** (`tests/unit/`) cover crypto, errors, pagination, RBAC, and service logic.

**Integration tests** (`tests/integration/`) test full HTTP request/response cycles including auth flows, MCP protocol, and database operations. These require Docker for Postgres.

From the repo root:

```bash
make api-test             # All tests
make api-test-unit        # Unit only
make api-test-integration # Integration only
```

## Related Docs

- [Contributing](../CONTRIBUTING.md) — Setup, workflow, conventions
- [Root README](../README.md) — Project overview
