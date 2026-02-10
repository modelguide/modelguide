<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/modelguide-logo-dark.svg" />
    <img src="assets/modelguide-logo-light.svg" height="60" alt="Model Guide" />
  </picture>
</p>

<h3 align="center">Your call center & support agent demo worked. Now ship it.</h3>

<p align="center">
  Self-hosted, open-source AI contact centers.<br/>
  Connect any voice/chat platform → your business systems → a full Contact Center for your team to run.<br/>
  Built on agentic engineering principles — adding a connector is one TypeScript file. Any AI coding agent can build one for you.<br/>
  No vendor lock-in. No per-resolution pricing. You own everything.
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT License" /></a>&nbsp;
  <a href="https://github.com/modelguide/modelguide/actions/workflows/ci.yml"><img src="https://github.com/modelguide/modelguide/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI Status" /></a>
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> · <a href="docs/guide/mcp-integration.md">Connect Your Agent</a> · <a href="docs/guide/admin-guide.md">Admin Guide</a> · <a href="#adding-a-connector">Build a Connector</a> · <a href="#roadmap">Roadmap</a>
</p>


## The Problem

You showed a call center/customer support demo to your CEO. Got "great, ship it."

Months later: the demo that worked for 10 calls breaks at 500. There's no QA. No way to know if Tuesday's prompt change helped or hurt. And you're rebuilding the same session tracking, tool integrations, and routing logic that every team rebuilds from scratch.

The AI agent is becoming a commodity. The voice stacks work. The LLMs work. What nobody gives you is the infrastructure to **run** AI agents like a real operation — with observability, tool management, vendor freedom, and the ability to swap any component without starting over.

SaaS charges $150K+ for that layer. We open-sourced it.

![Architecture diagram](./docs/architecture_image.png)

## What Model Guide Does

Model Guide sits between your AI agents and your business systems. It doesn't run the AI. It doesn't own the voice stack. It provides 4 layers:

**Tool layer** — Connectors expose your business systems (orders, tickets, calendars) as tools any AI agent can call via [MCP](https://modelcontextprotocol.io). One integration works with every platform.

![Connectors diagram](./docs/Connectors.png)

**Observation layer** — Every session recorded with full tool call traces: inputs, outputs, latency, errors, CSAT scores, internal QA. Not just "call duration" — what the agent *actually did*.

![Conversation diagram](./docs/Converstation.png)

**Configuration layer** — Agent configs, API keys, tool assignments, per-tool confirmation gates. Swap the voice platform, keep your entire backend.

![Control diagram](./docs/Data.png)

**Analytics layer** — Resolution rates, escalation trends, CSAT scores, session volume by channel — the metrics CX leaders actually need to prove AI is working, not vanity dashboards.

![Optimize diagram](./docs/Optimize.png)

## Quick Start

> **Prerequisites:** Docker 24+, Bun 1.1+, Node 22+

```bash
git clone https://github.com/modelguide/modelguide.git
cd modelguide
make quickstart
```

Then in separate terminals:

```bash
make api-dev    # API at http://localhost:3000
make ui-dev     # Dashboard at http://localhost:3001
```

Open `http://localhost:3001`. The seed creates a demo organization, a Pizza Palace agent with Medusa e-commerce tools, and an API key you can use to connect any voice platform.

API docs are auto-generated at `http://localhost:3000/docs`.

## How It Works

### 1. Define connectors in code

Each connector is a TypeScript module with a manifest and tool handlers:

```typescript
// src/features/connectors/catalog/medusa/index.ts
const manifest: ConnectorManifest = {
  name: "Medusa",
  slug: "medusa",
  description: "E-commerce connector for carts, orders, and products",
  connectorType: "api",
  configSchema: {
    baseUrl: { type: "string", required: true },
    publishableKey: { type: "string", required: true },
  },
  authMethods: ["api_key"],
  iconUrl: "https://medusajs.com/images/logo.svg",
  tools: [
    {
      catalog: {
        name: "Add to Cart",
        description: "Add an item to the shopping cart",
        inputSchema: { /* JSON Schema */ },
        defaultRequiresConfirmation: false,
      },
      handler: addToCart,  // actual HTTP call to Medusa API
    },
    // ... 7 more tools
  ],
};

export default manifest;
```

Run `make sync-connectors` to sync manifests to the database. Admins configure instances through the dashboard — set the API URL, link encrypted credentials, assign tools to agents.

### 2. Agents connect via MCP

External AI agents authenticate with an API key (`mgk_xxx`) and get their tools dynamically:

```
POST /mcp
Authorization: Bearer mgk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

→ tools/list returns only tools assigned to THIS agent
→ Each tool requires an active session_id
→ Tool names are namespaced: pizzapalace_add_to_cart
```

The MCP handler creates a fresh server per request, registers only the tools that agent is authorized to use, converts JSON Schema to Zod on the fly, and validates sessions before execution.

### 3. Sessions capture everything

Core MCP tools handle the session lifecycle:

- `core_create_session` — starts a session with channel type, user identifier, metadata
- `core_add_messages` — bulk ingest conversation turns with timestamps and tool calls
- `core_rate_session` — records CSAT (1 = negative, 2 = positive)
- `core_end_session` — closes the session

Every tool call, every message, every rating — stored and queryable through the REST API and dashboard.

### 4. Dashboard for ops

The dashboard gives support teams what they need: session list with filters (status, channel, agent, date range, feedback), full transcripts with expandable tool call traces showing request/response JSON, and the ability to evaluate agent performance with tags (`wrong_tool`, `hallucination`, `good_resolution`).

## Features

✅ **Connector System** — Code-defined manifests with real HTTP handlers. Ships with a Medusa e-commerce connector as a reference implementation (8 tools: browse products, manage carts, checkout, orders). Build your own — implement the `ConnectorManifest` interface and add a handler function per tool.

✅ **Tool Namespacing** — Connector instances get a unique slug. Same connector type, different instances: `pizzapalace_add_to_cart` and `burgerking_add_to_cart` coexist on the same agent.

✅ **MCP Protocol** — Standard [Model Context Protocol](https://modelcontextprotocol.io) over Streamable HTTP. Tool discovery, execution, and resources. Works with any MCP-compatible client.

✅ **Confirmation Gates** — Flag destructive tools as requiring customer confirmation before execution. The `requires_confirmation` flag tells the AI agent to verify intent before proceeding (e.g., completing a checkout).

✅ **Session Recording** — Full message history with roles, timestamps, audio URLs, tool call inputs/outputs. Sequence-numbered for correct ordering.

✅ **CSAT + QA** — Customer feedback via `core_rate_session`. Internal quality evaluation by support team with tags and comments. Both stored per session, filterable in dashboard.

✅ **Multi-Tenant** — PostgreSQL row-level security on every org-scoped table. Separate DB roles: superuser for migrations, app role subject to RLS policies. One deployment, multiple organizations.

✅ **Auth** — Magic link passwordless login for dashboard users. API key auth (`mgk_` prefix, SHA-256 hashed, shown once on creation) for agents. Refresh token rotation with family-based revocation.

✅ **RBAC** — Granular permissions across admin and support roles. Agents get a separate auth path — they can only access MCP, not REST endpoints.

✅ **Auto-Generated API Docs** — OpenAPI 3.1 spec generated from Hono route definitions. Scalar UI at `/docs`.

✅ **CI Pipeline** — Lint, typecheck, unit tests, integration tests on every PR. Includes MCP protocol tests using the official SDK client.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| API | [Hono](https://hono.dev) + [Bun.js](https://bun.sh) |
| Agent Protocol | [MCP](https://modelcontextprotocol.io) (`@modelcontextprotocol/sdk`) |
| Database | PostgreSQL 16 + [Drizzle ORM](https://orm.drizzle.team) |
| Dashboard | [TanStack Start](https://tanstack.com/start) + React 19 + Tailwind CSS v4 |
| Auth | JWT + magic links (users) · API keys (agents) |
| API Docs | [Scalar](https://scalar.com) (auto-generated from OpenAPI) |

No proprietary components. Every layer is inspectable, replaceable, forkable.

## Project Structure

```
modelguide/
├── modelguide-api/              # Hono API + MCP server
│   └── src/
│       ├── features/
│       │   ├── agents/          # Agent CRUD, tool assignment
│       │   ├── connectors/      # Connector config + catalog/
│       │   │   └── catalog/
│       │   │       ├── medusa/  # Medusa manifest + handlers
│       │   │       ├── registry.ts
│       │   │       └── sync.ts
│       │   ├── mcp/             # MCP handler, core tools, schema conversion
│       │   ├── sessions/        # Session lifecycle, messages, feedback
│       │   ├── secrets/         # Encrypted credential storage
│       │   └── users/           # Auth, RBAC, user management
│       ├── db/                  # Drizzle schema, RLS, seeds
│       └── lib/                 # Middleware, crypto, errors, pagination
├── modelguide-ui/               # Dashboard (TanStack Start)
│   └── src/
│       ├── features/            # agents, connectors, sessions, analytics
│       └── routes/              # File-based routing
├── docker/                      # PostgreSQL init (RLS roles)
├── docs/                        # Guides, ADRs, design system
└── Makefile                     # All dev commands
```

## Adding a Connector

1. Create `src/features/connectors/catalog/yourservice/index.ts`:

```typescript
import type { ConnectorManifest } from "../types";

const manifest: ConnectorManifest = {
  name: "Your Service",
  slug: "yourservice",
  description: "Short description of your connector",
  connectorType: "api",
  configSchema: {
    apiUrl: { type: "string", required: true, description: "API base URL" },
    apiKey: { type: "secret", required: true, description: "API key" },
  },
  authMethods: ["api_key"],
  iconUrl: "https://yourservice.com/logo.svg",
  tools: [
    {
      catalog: {
        name: "Do Thing",
        description: "Does the thing",
        inputSchema: {
          type: "object",
          properties: {
            thingId: { type: "string", description: "Thing ID" },
          },
          required: ["thingId"],
        },
        defaultRequiresConfirmation: false,
        defaultTimeoutSeconds: 30,
      },
      handler: async (ctx) => {
        // ctx.config has resolved secrets
        // ctx.input has validated parameters
        const response = await fetch(`${ctx.config.apiUrl}/things/${ctx.input.thingId}`);
        return { success: true, data: await response.json() };
      },
    },
  ],
};

export default manifest;
```

2. Register in `src/features/connectors/catalog/registry.ts`:

```typescript
const modules = await Promise.all([
  import("./medusa/index"),
  import("./yourservice/index"),  // add this
]);
```

3. Run `make sync-connectors`. Your tools are now available to assign to agents via the dashboard.

## Roadmap

🚧 **Zendesk connector** — Helpdesk integration with ticket management tools (create, update, comment, close)

🚧 **Confirmation token flow** — Flag exists per tool, full token-based confirmation with expiry coming

🚧 **Analytics aggregation** — Session data is stored; summary endpoints and dashboard charts in progress

📋 **Chat channels** — Web widget, WhatsApp, SMS (session model already supports all channel types)

📋 **Knowledge base connector** — Agents answer from your docs, not just perform actions

📋 **Agent comparison** — Same tools, different platforms or prompts. Compare resolution rates, CSAT, tool success with real data

📋 **Warm transfer** — Live agent availability + real-time context handoff

📋 **Connector marketplace** — Community-built integrations

## Documentation

| Resource | Description |
|----------|-------------|
| [MCP Integration Guide](docs/guide/mcp-integration.md) | Connect your AI agent via MCP |
| [Admin Guide](docs/guide/admin-guide.md) | Configure connectors, agents, and tools |
| [Architecture Decisions](docs/decisions/) | ADRs for significant design choices |
| [Contributing](CONTRIBUTING.md) | Setup, workflow, conventions |

## Contributing

Contributions welcome. No CLA. See [CONTRIBUTING.md](CONTRIBUTING.md) for the full guide.

```bash
# Run checks before submitting
make api-test          # Unit + integration tests
make ui-test           # UI component tests
make api-lint-check    # Linting
make api-typecheck     # Type checking
```

Check [open issues](https://github.com/modelguide/modelguide/issues) — look for `good first issue`. Fork → branch → PR with tests.

## License

[MIT](LICENSE)

---

<p align="center">
  Built by <a href="https://modelguide.dev">ModelGuide</a> · 🇵🇱 Poland
</p>
