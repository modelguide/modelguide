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
    ├── auth/             # JWT for Admin/Support, API key (mgk_xxx) for Agents
    ├── organization/     # Multitenancy, RLS context
    ├── account/          # User accounts (admin, support roles)
    ├── agent/            # Agent CRUD, activation, API key generation
    ├── connector/        # Connector catalog, instances, tools
    ├── secret/           # Encrypted credentials storage
    ├── session/          # Session lifecycle, messages
    ├── feedback/         # Customer CSAT, support evaluations
    ├── analytics/        # Summary metrics, trends
    └── mcp/              # MCP server, resources, core tools
```

### Authentication Model

- **Admin/Support:** JWT tokens with `X-Organization-ID` header
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
