<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/modelguide-logo-dark.svg" />
    <img src="assets/modelguide-logo-light.svg" height="60" alt="Model Guide" />
  </picture>
</p>

<h3 align="center">Voice AI worth talking to.</h3>

<p align="center">
  <strong>Unlock your voice agent</strong> with business context, tools, and monitoring.<br/>
  The open-source orchestration framework for agents on <strong>LiveKit</strong>, <strong>Pipecat</strong>, <strong>ElevenLabs</strong>, or <strong>Mastra</strong>.<br/>
  <em>No vendor lock-in. Bring your own models.</em>
</p>

<p align="center">
  <strong>Start from a reference voice agent →</strong>
  <a href="examples/agents/livekit-agent/"><strong>LiveKit</strong></a> ·
  <a href="examples/agents/pipecat-agent/">Pipecat</a> ·
  <a href="examples/agents/elevenlabs-agent/">ElevenLabs</a> ·
  <a href="examples/agents/mastra-wismo-email-agent/">Mastra</a>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT License" /></a>&nbsp;
  <a href="https://github.com/modelguide/modelguide/actions/workflows/ci.yml"><img src="https://github.com/modelguide/modelguide/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI Status" /></a>&nbsp;
  <a href="https://cla-assistant.io/modelguide/modelguide"><img src="https://cla-assistant.io/readme/badge/modelguide/modelguide" alt="CLA assistant" /></a>
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> · <a href="#reference-voice-agents">Reference Agents</a> · <a href="docs/guide/mcp-integration.md">Connect Your Agent</a> · <a href="docs/guide/admin-guide.md">Admin Guide</a> · <a href="#adding-a-connector">Build a Connector</a> · <a href="#roadmap">Roadmap</a>
</p>

<a href="https://www.youtube.com/watch?v=melFDGiA6gg" target="_blank"><img src="https://img.youtube.com/vi/melFDGiA6gg/maxresdefault.jpg" alt="ModelGuide Demo" /></a>

## The Problem

Your voice agent handles demos. Production needs business context, tool access, evals, SOPs, and integrations with every system your company runs. Every team rebuilds this from scratch.

You wire up LiveKit or Pipecat, pick an LLM and a TTS — and the agent talks. But it can't check an order, follow your cancellation policy, or tell you what happened after the call.

The boring stuff between "it works" and "it ships" — that's what kills timelines. Not the AI. Every team rebuilds the same harness: auth, sessions, connectors, SOPs, evals, analytics, guardrails, cost tracking. We open-sourced it.

Fork the contact center blueprint and customize the parts that make your agent yours — or start fresh for any vertical: healthcare intake, field service, B2B sales, internal ops.

![Architecture diagram](./docs/architecture_image.png)

## What ModelGuide Does

<video src="https://github.com/user-attachments/assets/811f1756-4948-461e-abdd-7691ee3d9ccc
" controls width="100%"></video>

ModelGuide is the infrastructure layer between your voice agent and your business systems. It doesn't run the AI or own the voice stack — it draws a clear line between what you own and what it ships, over [MCP](https://modelcontextprotocol.io):

### What you own, what ModelGuide ships

| Concern | You own | ModelGuide ships |
|---|---|---|
| **Voice stack** | LiveKit / Pipecat / ElevenLabs / Mastra runtime; LLM, STT, TTS provider | Reference agents for every runtime ([`examples/agents/`](examples/agents/)) |
| **Agent behavior** | Role, persona, business policies | Prompt compiler with voice-tuned strategies, business context injected via SOPs + guardrails |
| **Business systems** | Your CRM, orders, tickets, calendars | MCP tool surface with per-agent tool gating, response trimming for voice latency budgets, per-tool confirmation gates |
| **Conversation state** | — *this is ours* | Session recording, full tool traces, per-message cost tracking, automatic SOP classification |
| **Quality** | Success criteria, eval prompts, personas | Evals framework, guardrails, simulations (replay conversations with synthetic personas through your agent), CSAT + internal QA tags |
| **Deployment** | Infra, data, branding | Multi-tenant auth (RLS, encrypted secrets, hashed API keys), one-command YAML blueprints |

**Plays well with your observability stack.** ModelGuide's dashboard is built for customer-support ops — transcript review, QA tagging, CSAT, SOP adherence. For engineering observability (LLM latency histograms, prompt diffing, OpenTelemetry traces), keep running Langfuse, Datadog, or Honeycomb. The reference agents are plain Python or TypeScript services — instrument them the same way you instrument anything else.

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

## Reference Voice Agents

Every framework ships with a working example. Fork one, point it at your ModelGuide MCP endpoint, and you have a voice agent with business context, tools, guardrails, and session tracking — without rebuilding the harness.

### LiveKit Agents · [`examples/agents/livekit-agent/`](examples/agents/livekit-agent/)

**The flagship reference.** Production Python agent for WebRTC and phone — LiveKit Cloud transport, Silero VAD, Deepgram Nova-3 STT, GPT-4.1-mini with function calling, ElevenLabs Flash v2.5 TTS. SIP trunking (inbound via LiveKit phone numbers, outbound via Twilio), 11 MCP tools wired up, eval tests under `tests/`, Dockerfile, and [`DEPLOY.md`](examples/agents/livekit-agent/DEPLOY.md) walking through LiveKit Cloud region deployment.

### Pipecat · [`examples/agents/pipecat-agent/`](examples/agents/pipecat-agent/)

Python agent for Pipecat Cloud. Same MCP tool wiring, different voice runtime — pick this if your team already runs on Pipecat.

### ElevenLabs Conversational AI · [`examples/agents/elevenlabs-agent/`](examples/agents/elevenlabs-agent/)

TypeScript management CLI for ElevenLabs Agents. Sync the ElevenLabs platform agent config, tools, and prompt from a local definition. Pair with the ModelGuide UI sync flow for production — see [`docs/elevenlabs-setup.md`](docs/elevenlabs-setup.md).

### Mastra · [`examples/agents/mastra-wismo-email-agent/`](examples/agents/mastra-wismo-email-agent/)

Mastra TypeScript agent for the email "Where Is My Order?" workflow — Resend inbound webhook → Hono handler → ModelGuide MCP session + tool calls → reply. Shows that the same orchestration layer serves non-voice channels when the business needs them.

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

## Also ships

Things that don't fit neatly in the table above but matter in production: **RBAC** (admin/support/agent with separate auth paths — agents only reach MCP, never REST), **auto-generated OpenAPI 3.1 docs** from Hono route definitions served at `/docs` via Scalar, and a **full CI pipeline** running lint, typecheck, unit, integration, and MCP-protocol tests on every PR. See [ADR-005](docs/decisions/005-sops-as-core-primitive.md) for the SOP primitive, [ADR-007](docs/decisions/007-evaluation-engine.md) and [ADR-009](docs/decisions/009-eval-suites.md) for the evals engine.

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

**1. Define connectors in code.** Each connector is a TypeScript module exporting a `ConnectorManifest` with tool handlers. `make sync-connectors` loads the catalog into the database; admins configure instances through the dashboard. Full walkthrough: [`docs/guide/adding-a-connector.md`](docs/guide/adding-a-connector.md).

**2. Agents connect over MCP.** External voice agents authenticate with an API key (`mgk_xxx`) at `POST /mcp`. `tools/list` returns only the tools assigned to that agent; every tool call requires an active `session_id`. The MCP handler creates a fresh server per request, registers only authorized tools, converts JSON Schema to Zod on the fly, and validates sessions before execution.

**3. Sessions capture everything.** Core MCP tools (`core_create_session`, `core_add_messages`, `core_rate_session`, `core_end_session`) handle the session lifecycle. Every tool call, every message, every rating is stored with per-message cost tracking and automatic SOP classification, queryable through the REST API and dashboard.

**4. Dashboard for ops.** Session list with filters (status, channel, agent, date, feedback), full transcripts with expandable tool call traces, and QA tags (`wrong_tool`, `hallucination`, `good_resolution`). For engineering observability, pipe your voice runtime to Langfuse or OpenTelemetry separately.

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

## Project Structure

```
modelguide/
├── modelguide-api/              # Hono API + MCP server
│   └── src/
│       ├── cli/                 # mg CLI — org provisioning tool
│       │   ├── commands/        # One file per command
│       │   ├── examples/acme/   # Sample YAML configs
│       │   ├── lib/             # IdRegistry, YAML loader, logger
│       │   └── schemas/         # Zod validation for YAML files
│       ├── features/
│       │   ├── agents/          # Agent CRUD, tool assignment
│       │   ├── connectors/      # Connector config + catalog/
│       │   │   └── catalog/
│       │   │       ├── medusa/  # Medusa manifest + handlers
│       │   │       ├── registry.ts
│       │   │       └── sync.ts
│       │   ├── mcp/             # MCP handler, core tools, schema conversion
│       │   ├── sops/            # SOP templates, definitions, agent assignment
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

🚧 **Sub-agents & Workflow Builder** — Compose multi-step voice agent workflows with branching and handoffs

🚧 **OTEL + A/B Testing via Langfuse** — OpenTelemetry traces, prompt variant experiments, side-by-side comparison

🚧 **Agentic Insights** — Custom funnels tracking agent behavior through business-defined conversion paths

🚧 **Auto-tuning SOPs** — Feedback loop from evals to automatically refine operating procedures

📋 **More Blueprints** — Contact center ships first; healthcare intake, field service, B2B sales next

📋 **Connector Marketplace** — Community-built integrations

## Deployment

Docker Compose for local and staging (`make docker-up`), Railway for production. The Railway architecture is PostgreSQL + API + UI + Caddy load balancer (the LB is the only public-facing service, routing `/api/*` and `/mcp` to the API and everything else to the UI over Railway's internal network). Config is as-code via `railway.toml` per service — full setup and deploy steps in [`railway/DEPLOY.md`](railway/DEPLOY.md).

## CLI — Customer Onboarding

The `mg` CLI provisions new organizations from YAML configs. Create a directory anywhere with your YAML files and run one command to set up an org with users, connectors, agents, SOPs, guardrails, and demo sessions.

```bash
cd modelguide-api

# Full setup from a YAML directory (path can be absolute or relative)
bun run src/cli/mg.ts setup /path/to/my-org/

# Dry-run — validate all YAML and print plan without touching the DB
bun run src/cli/mg.ts setup /path/to/my-org/ --dry-run

# Skip interactive secret prompts (uses placeholders — useful for testing/CI)
bun run src/cli/mg.ts setup /path/to/my-org/ --skip-secrets
```

**Running against Railway** (from your local machine):

```bash
cd modelguide-api

railway run --service api -- sh -c \
  'DATABASE_URL=postgresql://modelguide_app:$APP_DB_PASSWORD@$POSTGRES_TCP_PROXY_DOMAIN:$POSTGRES_TCP_PROXY_PORT/$PGDATABASE \
   bun run src/cli/mg.ts setup /path/to/my-org/ --skip-secrets'
```

This uses `railway run` to inject all env vars (secrets, encryption keys, etc.) and overrides `DATABASE_URL` with the public TCP proxy since the private hostname isn't reachable locally. Requires the TCP proxy vars from [DEPLOY.md step 6](railway/DEPLOY.md).

The setup directory needs only `org.yaml` (required). All other files are optional: `users.yaml`, `secrets.yaml`, `connectors.yaml`, `agents.yaml`, `sops.yaml`, `guardrails.yaml`, `sessions.yaml`. Additional flags: `--skip-compile` (skip agent compilation), `--skip-sessions` (skip session import).

**Individual commands** for incremental setup:

```bash
bun run src/cli/mg.ts create-org --from /path/to/org.yaml
bun run src/cli/mg.ts add-users --org acme --from /path/to/users.yaml
bun run src/cli/mg.ts add-secrets --org acme --from /path/to/secrets.yaml
bun run src/cli/mg.ts add-connectors --org acme --from /path/to/connectors.yaml
bun run src/cli/mg.ts add-agents --org acme --from /path/to/agents.yaml
bun run src/cli/mg.ts import-sops --org acme /path/to/sops.yaml
bun run src/cli/mg.ts import-guardrails --org acme /path/to/guardrails.yaml
bun run src/cli/mg.ts compile-agents --org acme
bun run src/cli/mg.ts import-sessions --org acme /path/to/sessions.yaml
```

All provisioning commands are idempotent and safe to re-run — orgs upsert on slug, duplicate entities are skipped, and session imports dedupe on `externalId` (explicit or derived from a deterministic payload hash). Standalone `add-secrets` is append-only (use `--skip-secrets` on re-runs). See `src/cli/examples/acme/` for sample YAML files and [ADR-010](docs/decisions/010-cli-onboarding-tool.md) for design decisions.

## Documentation

| Resource | Description |
|----------|-------------|
| [MCP Integration Guide](docs/guide/mcp-integration.md) | Connect your AI agent via MCP |
| [Admin Guide](docs/guide/admin-guide.md) | Configure connectors, agents, and tools |
| [CLI Examples](modelguide-api/src/cli/examples/acme/) | Sample YAML configs for org provisioning |
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
  Built by <a href="https://modelguide.ai">ModelGuide</a> · The open-source orchestration framework for production voice agents · 🇵🇱 Poland
</p>
