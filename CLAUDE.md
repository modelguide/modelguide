# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ModelGuide is a platform that connects external AI agents (voice/chat) with service connectors (e-commerce, helpdesk, calendar) via the MCP (Model Context Protocol). It enables AI agents to discover and execute tools from configured connectors.

**Key concepts:**
- **Connectors Catalog**: Global read-only registry of connector types (Medusa, Zendesk, Calendly) defined in code
- **Connectors**: Organization-specific instances with configuration and credentials
- **Agents**: AI agents (voice for V1) that authenticate via API keys and access tools via MCP
- **Tools**: Connector actions exposed to agents, prefixed by connector slug (e.g., `pizzapalace_add_to_cart`)
- **Sessions**: Conversation tracking between customers and agents

## Development Commands

```bash
make                 # Show all available commands
make api-install     # Install API dependencies (uv sync)
make api-dev         # Run API server with hot reload on port 8000
make api-test        # Run pytest tests
```

## Architecture

### Backend (control-panel-api)

FastAPI + FastMCP application serving:
- REST API at `/api/*` for admin/support users (JWT auth)
- MCP at `/mcp` (SSE transport) for agent tool discovery (API key auth)

Entry point: `control-panel-api/src/control_panel_api/main.py`

```
control-panel-api/
├── src/control_panel_api/
│   ├── main.py      # FastAPI + FastMCP app
│   └── config.py    # Pydantic settings (MODELGUIDE_ env prefix)
└── tests/
```

### Authentication

- **Admin/Support**: JWT token + `X-Organization-ID` header
- **Agents**: API key (`mgk_xxx`) - identifies agent, scoped to organization via RLS

### Tool Naming Convention

Tools are prefixed by connector instance slug:
```
{connector.slug}_{tool_name}
```
Examples: `medusa_add_to_cart`, `zendesk_create_ticket`, `core_create_session`

Core tools (`core_*`) are built-in platform tools for session management.

## Key Documentation

- `docs/PRD.md` - Use cases, personas, flows
- `docs/api-spec.md` - REST API and MCP specification
- `docs/DB_SCHEMA.md` - Database schema (PostgreSQL with RLS)

## Database

PostgreSQL with Row-Level Security (RLS) for multitenancy. All tables (except `connectors_catalog`) are scoped by `organization_id`.

Key tables: `organizations`, `users`, `connectors_catalog`, `connectors`, `connector_tools`, `secrets`, `agents`, `api_keys`, `agent_connector_tools`, `sessions`, `session_messages`, `session_feedback`
