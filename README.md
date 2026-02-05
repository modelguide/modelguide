# ModelGuide

Platform connecting AI agents with service connectors via MCP (Model Context Protocol). Agents discover and execute tools from configured connectors (e-commerce, helpdesk, calendar).

## Structure

```
modelguide/
├── control-panel-api/    # FastAPI + FastMCP backend
├── control-panel-app/    # Frontend (planned)
├── examples/             # Agent integration examples
├── scripts/              # Utility scripts
└── docs/                 # PRD, API spec, DB schema
```

## Quick Start

```bash
make api-install    # Install dependencies
make api-dev        # Run API on http://localhost:8000
```

## Commands

```bash
make                # Show all commands
make api-install    # Install API dependencies (uv sync)
make api-dev        # Run API with hot reload (port 8000)
make api-test       # Run tests
```

## Endpoints

- `/docs` - OpenAPI documentation
- `/api/*` - REST API (admin/support)
- `/mcp` - MCP server (agent tools)