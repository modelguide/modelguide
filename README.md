# ModelGuide

AI agent management platform connecting external AI agents with service connectors via MCP.

## Tech Stack

Bun.js, Hono, Drizzle ORM, PostgreSQL, @modelcontextprotocol/sdk

## Setup

```bash
# Install dependencies
make install

# Start PostgreSQL
make db-up

# Run dev server
make dev
```

Server runs at http://localhost:3000

## Endpoints

- `/api/health` - Health check
- `/docs` - API documentation
- `/mcp` - MCP endpoint for AI agents

## Documentation

- [API Specification](docs/api-spec.md)
- [Database Schema](docs/DB_SCHEMA.md)
- [Product Requirements](docs/PRD.md)
