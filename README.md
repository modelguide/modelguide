<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/modelguide-logo-dark.svg" />
    <img src="assets/modelguide-logo-light.svg" height="60" alt="Model Guide" />
  </picture>
</p>

<h3 align="center">Ship support & sales agents with confidence.</h3>

<p align="center">
  Open-source production harness for AI agents — voice, chat, email, any channel.<br/>
  SOPs · Connectors · Session Recording · Evals · RBAC — one TypeScript codebase, zero vendor lock-in.
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT License" /></a>&nbsp;
  <a href="https://github.com/modelguide/modelguide/actions/workflows/ci.yml"><img src="https://github.com/modelguide/modelguide/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI Status" /></a>&nbsp;
  <a href="https://cla-assistant.io/modelguide/modelguide"><img src="https://cla-assistant.io/readme/badge/modelguide/modelguide" alt="CLA assistant" /></a>
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> · <a href="docs/guide/mcp-integration.md">Connect Your Agent</a> · <a href="docs/guide/admin-guide.md">Admin Guide</a> · <a href="#adding-a-connector">Build a Connector</a> · <a href="#roadmap">Roadmap</a>
</p>


## The Problem

Your agent handles demos. Production needs session tracking, tool management, evals, SOPs, and integrations with every system your company runs. Every team rebuilds this from scratch.

Today you ship a chat agent. Tomorrow the business wants voice and email — and you're starting over because nothing was built to carry across channels.

The boring stuff between "it works" and "it ships" — that's what kills timelines. Not the AI. SaaS charges $150K+ for this harness. We open-sourced it.

80% of the infrastructure comes ready: auth, sessions, connectors, SOPs, evals, analytics. You customize the 20% that makes your agent yours. The first blueprint — a contact center agent — is shipping now. Fork it, or start fresh for any vertical: healthcare intake, field service, B2B sales, internal ops.

![Architecture diagram](./docs/architecture_image.png)

## What ModelGuide Does

ModelGuide is the infrastructure layer between your AI agents and your business systems. It doesn't run the AI or own the voice stack — it gives you four production-ready layers you'd otherwise build from scratch:

**Tool layer** — Connectors expose your business systems (orders, tickets, calendars) as tools any AI agent can call via [MCP](https://modelcontextprotocol.io). One integration works with every platform.

**Observation layer** — Every session recorded with full tool call traces: inputs, outputs, latency, errors, CSAT scores, internal QA. Not just "call duration" — what the agent *actually did*.

**Configuration layer** — Agent configs, API keys, tool assignments, per-tool confirmation gates. Swap the voice platform, keep your entire backend.

**SOP layer** — Define step-by-step procedures, link them to specific tools, and assign them to agents. Agents follow your playbook instead of improvising — consistent behavior across every interaction.

**Analytics layer** — Resolution rates, escalation trends, CSAT scores, session volume by channel — the metrics you need to prove agents are working, not vanity dashboards.

<table>
  <tbody>
    <tr>
      <td align="center"><strong>Connectors</strong></td>
      <td align="center"><strong>Sessions</strong></td>
      <td align="center"><strong>Agents</strong></td>
    </tr>
    <tr>
      <td><a href="./docs/Connectors.png"><img src="./docs/Connectors.png" alt="Connectors" width="260"></a></td>
      <td><a href="./docs/Converstation.png"><img src="./docs/Converstation.png" alt="Sessions" width="260"></a></td>
      <td><a href="./docs/Data.png"><img src="./docs/Data.png" alt="Agents" width="260"></a></td>
    </tr>
    <tr>
      <td align="center"><strong>SOPs</strong></td>
      <td align="center"><strong>Analytics</strong></td>
      <td></td>
    </tr>
    <tr>
      <td><a href="./docs/SOPs.png"><img src="./docs/SOPs.png" alt="SOPs" width="260"></a></td>
      <td><a href="./docs/Optimize.png"><img src="./docs/Optimize.png" alt="Analytics" width="260"></a></td>
      <td></td>
    </tr>
  </tbody>
</table>

## Features

Everything you need to go from demo to production:

✅ **Connector System** — Code-defined manifests with real HTTP handlers. Ships with a Medusa e-commerce connector as a reference implementation (8 tools: browse products, manage carts, checkout, orders). Build your own — implement the `ConnectorManifest` interface and add a handler function per tool.

✅ **Tool Namespacing** — Connector instances get a unique slug. Same connector type, different instances: `glowbox_store_add_to_cart` and `clearhealth_pharmacy_add_to_cart` coexist on the same agent.

✅ **MCP Protocol** — Standard [Model Context Protocol](https://modelcontextprotocol.io) over Streamable HTTP. Tool discovery, execution, and resources. Works with any MCP-compatible client.

✅ **Confirmation Gates** — Flag destructive tools as requiring customer confirmation before execution. The `requires_confirmation` flag tells the AI agent to verify intent before proceeding (e.g., completing a checkout).

✅ **Session Recording** — Full message history with roles, timestamps, audio URLs, tool call inputs/outputs. Sequence-numbered for correct ordering.

✅ **CSAT + QA** — Customer feedback via `core_rate_session`. Internal quality evaluation by support team with tags and comments. Both stored per session, filterable in dashboard.

✅ **Multi-Tenant** — PostgreSQL row-level security on every org-scoped table. Separate DB roles: superuser for migrations, app role subject to RLS policies. One deployment, multiple organizations.

✅ **Auth** — Magic link passwordless login for dashboard users. API key auth (`mgk_` prefix, SHA-256 hashed, shown once on creation) for agents. Refresh token rotation with family-based revocation.

✅ **RBAC** — Granular permissions across admin and support roles. Agents get a separate auth path — they can only access MCP, not REST endpoints.

✅ **Auto-Generated API Docs** — OpenAPI 3.1 spec generated from Hono route definitions. Scalar UI at `/docs`.

✅ **SOPs (Standard Operating Procedures)** — Define agent behavioral contracts: ordered steps with tool references, triggers, and metadata. Fork from reusable templates or create from scratch. Draft/active/archived lifecycle. Assign SOPs to agents. Inactive-tool warnings at read time. See [ADR-005](docs/decisions/005-sops-as-core-primitive.md).

✅ **CI Pipeline** — Lint, typecheck, unit tests, integration tests on every PR. Includes MCP protocol tests using the official SDK client.

## AI-Assisted Development

ModelGuide is built with AI coding agents, not just for them. We're progressively building a development harness — enforced module boundaries, structured issue specs, mechanical convention enforcement via CI, and agent-to-agent code review — so that any AI coding agent can implement features, write tests, and open PRs with minimal hand-holding. We also use slash commands available to all contributors for common workflows like committing, reviewing PRs, and implementing issues.

We'll keep harness artifacts public.

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

Open `http://localhost:3001`. The seed creates three industry-vertical organizations — each with Medusa e-commerce and Zendesk helpdesk connectors, two agents, and ~300 realistic sessions. Log in with `delivered+admin-glowbox@resend.dev` (magic link printed to API console).

See [Seed Data](#seed-data) for the full list of organizations and use cases.

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
  iconUrl: "/logos/medusa.svg",
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
→ Tool names are namespaced: glowbox_store_add_to_cart
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

## Seed Data

`make db-seed` populates three organizations that demonstrate ModelGuide across different industries. Each org gets both **Medusa** (e-commerce) and **Zendesk** (helpdesk) connectors, two agents, ~300 generated sessions with tool calls, and handwritten showcase conversations. The seed also creates SOP templates (global catalog) and demo SOP definitions with agent assignments for the default org.

| Organization | Slug | Industry | Use Case |
|---|---|---|---|
| **GlowBox Beauty** | `glowbox` | Retail / Beauty | "Where is my order?" + product recommendations. Web-dominant channel mix. Demo-enabled org for instant viewer login. |
| **ClearHealth** | `clearhealth` | Medical Call Center | Patient support — Rx refills, appointment scheduling, insurance questions, lab results. Voice-dominant channel mix. |
| **SteelPoint Supply** | `steelpoint` | B2B Industrial | Quotes, bulk orders, technical specs, delivery scheduling. Email/Slack-heavy channel mix. |

**Session scenarios** cover 8 types: product inquiry, purchase flow, order status, return/exchange, ticket lookup, ticket creation, ticket escalation, and general questions. Each org's sessions use industry-appropriate products, ticket templates, and conversation language.

**Dev accounts** (magic link auth — link printed to API console):

| Org | Admin | Support | Viewer |
|-----|-------|---------|--------|
| GlowBox | `delivered+admin-glowbox@resend.dev` | `delivered+support-glowbox@resend.dev` | `delivered+viewer-glowbox@resend.dev` |
| ClearHealth | `delivered+admin-clearhealth@resend.dev` | `delivered+support-clearhealth@resend.dev` | `delivered+viewer-clearhealth@resend.dev` |
| SteelPoint | `delivered+admin-steelpoint@resend.dev` | `delivered+support-steelpoint@resend.dev` | `delivered+viewer-steelpoint@resend.dev` |

The seed is config-driven — each vertical is a single TypeScript file in `modelguide-api/src/db/seed/verticals/`. Adding a new organization means creating a new config file and importing it in `seed/index.ts`.

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
│       │   ├── sops/             # SOP templates, definitions, agent assignment
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

🚧 **Evals Framework** — Structured evaluation pipelines for agent responses — accuracy, tool selection, hallucination detection, SOP adherence scoring

🚧 **Sub-agents & Workflow Builder** — Compose multi-step agent workflows with branching and handoffs

🚧 **OTEL + A/B Testing via Langfuse** — OpenTelemetry traces, prompt variant experiments, side-by-side comparison

🚧 **Agentic Insights** — Custom funnels tracking agent behavior through business-defined conversion paths

🚧 **Auto-tuning SOPs** — Feedback loop from evals to automatically refine operating procedures

🚧 **Full Interoperability** — Deploy the same agent via Pipecat, LiveKit, Google ADK, or any runtime

📋 **More Blueprints** — Contact center ships first; healthcare intake, field service, B2B sales next

📋 **Connector Marketplace** — Community-built integrations

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

**Deploying changes:**

```bash
(cd modelguide-api && railway up --service api)
(cd modelguide-ui && railway up --service ui)
(cd railway/lb && railway up --service lb)
```

Only redeploy the service(s) you changed. The API runs `scripts/release.ts` (migrations) automatically on every deploy via `preDeployCommand` in `railway.toml`.

## Documentation

| Resource | Description |
|----------|-------------|
| [MCP Integration Guide](docs/guide/mcp-integration.md) | Connect your AI agent via MCP |
| [Admin Guide](docs/guide/admin-guide.md) | Configure connectors, agents, and tools |
| [Architecture Decisions](docs/decisions/) | ADRs for significant design choices |
| [Deployment Guide](railway/DEPLOY.md) | Railway production deployment |
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
  Built by <a href="https://modelguide.ai">ModelGuide</a> · The open-source harness for production AI agents · 🇵🇱 Poland
</p>
