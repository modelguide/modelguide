<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/modelguide-logo-dark.svg" />
    <img src="assets/modelguide-logo-light.svg" height="60" alt="Model Guide" />
  </picture>
</p>

<h3 align="center">Own your agent stack.</h3>

<p align="center">
  ModelGuide is the open-source orchestration layer for production <strong>voice-first agents</strong>.<br/>
  Keep your runtime. Connect business systems once. Enforce playbooks, standard operating procedures (SOPs), and guardrails centrally.<br/>
  Review, evaluate, and improve every customer interaction in your own environment.
</p>

<p align="center">
  <em>No vendor lock-in. Bring your own models, runtimes, channels, and deployment.</em>
</p>

<p align="center">
  <strong>Start with a reference implementation →</strong>
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
  <a href="#quick-start">Quick Start</a> · <a href="#reference-agents">Reference Agents</a> · <a href="docs/guide/mcp-integration.md">Connect Your Agent</a> · <a href="docs/guide/admin-guide.md">Admin Guide</a> · <a href="docs/guide/adding-a-connector.md">Build a Connector</a> · <a href="#roadmap">Roadmap</a>
</p>

<a href="https://www.youtube.com/watch?v=melFDGiA6gg" target="_blank"><img src="https://img.youtube.com/vi/melFDGiA6gg/maxresdefault.jpg" alt="ModelGuide Demo" /></a>

## The Production Gap

A real-time agent can talk in a day. Getting it into production takes much longer.

The delay is not the model. It is the layer around it: business tool access, policy enforcement, session history, QA workflows, evals, onboarding, and deployment.

Most teams assemble that layer from custom glue code and vendor dashboards. That slows launch, fragments ownership, and creates migration risk whenever the runtime, model, or channel changes.

ModelGuide gives you that layer as open source. Start with voice. Extend to other customer-facing channels when needed.

![Architecture diagram](./docs/architecture_image.png)

## What ModelGuide Is

<video src="https://github.com/user-attachments/assets/811f1756-4948-461e-abdd-7691ee3d9ccc
" controls width="100%"></video>

ModelGuide sits between your agent runtime and your business systems. It is not a voice runtime and it is not a hosted black box. It is the orchestration layer you own.

- Connect business systems once over [MCP](https://modelcontextprotocol.io)
- Assign the right tools to each agent with confirmation gates and secure credentials
- Compile SOPs and guardrails into agent behavior
- Record sessions with transcripts, tool traces, CSAT, and QA tags
- Run evals and simulations against real workflows
- Provision new organizations from repeatable YAML blueprints

## Why CTOs Use ModelGuide

| Outcome | What ModelGuide gives you |
|---|---|
| **Closed feedback loop** | Run simulations and evals, turn failed conversations into reusable test cases and evaluators, and recompile better instructions |
| **Faster production launch** | The missing layer around the model: tools, SOPs, sessions, evals, and operator workflows |
| **Lower vendor risk** | Keep LiveKit, Pipecat, ElevenLabs, Mastra, or your own runtime. The business layer stays portable. |
| **Central governance** | One place to control tool access, guardrails, confirmation policies, and quality review |
| **Operational visibility** | Full session records, tool traces, CSAT, QA tags, and eval results |
| **Deployment control** | Open-source, self-hostable infrastructure with multi-tenant auth, encrypted secrets, and row-level security |

ModelGuide covers operational visibility for support and ops teams: transcripts, tool traces, CSAT, QA tags, SOP adherence, and eval results. It is designed to complement, not replace, engineering observability. Keep Langfuse, Datadog, Honeycomb, or OpenTelemetry for runtime telemetry and infrastructure tracing.

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
      <td align="center"><strong>Evals</strong></td>
    </tr>
    <tr>
      <td><a href="./docs/SOPs.png"><img src="./docs/SOPs.png" alt="SOPs" width="260"></a></td>
      <td><a href="./docs/Optimize.png"><img src="./docs/Optimize.png" alt="Analytics" width="260"></a></td>
      <td><a href="./docs/evals.png"><img src="./docs/evals.png" alt="Evals" width="260"></a></td>
    </tr>
  </tbody>
</table>

## Reference Agents

The reference agents prove that the orchestration layer stays portable across runtimes and channels.

Start with the LiveKit implementation for the fastest end-to-end path. Use the Pipecat or ElevenLabs examples if your team already runs there. The Mastra example shows the same orchestration layer extending beyond voice when you need another customer-facing channel.

| Runtime | Why it exists | Path |
|---|---|---|
| **LiveKit Agents** *(flagship)* | Fastest path to a production voice agent with telephony, MCP tool wiring, session tracking, eval tests, and deployment docs | [`examples/agents/livekit-agent/`](examples/agents/livekit-agent/) |
| **Pipecat** | Same orchestration model for teams already committed to Pipecat | [`examples/agents/pipecat-agent/`](examples/agents/pipecat-agent/) |
| **ElevenLabs Conversational AI** | Manage platform agent config, tools, and prompts from version-controlled local definitions | [`examples/agents/elevenlabs-agent/`](examples/agents/elevenlabs-agent/) |
| **Mastra** | Email "Where Is My Order?" example showing the orchestration layer extends beyond voice when you need another customer-facing channel | [`examples/agents/mastra-wismo-email-agent/`](examples/agents/mastra-wismo-email-agent/) |

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

Open `http://localhost:3001`. The seed creates three industry-vertical organizations — retail, medical call center, B2B industrial — each with Medusa e-commerce and Zendesk helpdesk connectors, two agents, and ~300 realistic sessions. Log in with `delivered+admin-glowbox@resend.dev` (magic link printed to API console).

Full vertical matrix, dev accounts, and session scenarios: [`docs/guide/seed-data.md`](docs/guide/seed-data.md).

## How Teams Use ModelGuide

**1. Define the agent you want.** Import SOPs, guardrails, persona, desired behavior, connectors, and tools. ModelGuide keeps that operational context in one place.

**2. Generate the instructions your runtime uses.** ModelGuide compiles that context into agent instructions and exposes the approved business tools over MCP.

**3. Generate test assets automatically.** ModelGuide creates synthetic conversations, eval suites, evaluators, and QA workflows to test the agent before it reaches production traffic.

**4. Run the feedback loop.** ModelGuide runs simulations, scores behavior, and gives your team transcripts, tool traces, CSAT, QA tags, and eval results to review.

**5. Tighten the operating context.** Use failures to update SOPs, guardrails, persona, tools, and compiled instructions until the automated checks consistently look right.

**6. Validate manually before launch.** Once the agent passes the automated checks, run manual tests in your runtime and confirm the experience is good enough to ship.

The closed feedback loop is already here: define the context, compile the instructions, generate tests, run simulations, score behavior, and improve the agent from failures. Over time, more of the prompt and context fixes can be automated.

## Onboarding an Organization

The `mg` CLI provisions a new organization from a directory of YAML files — users, connectors, agents with compiled instructions, SOPs, guardrails, and demo sessions — in one command. Safe to re-run against the same directory.

```bash
bun run src/cli/mg.ts setup /path/to/my-org/
```

Full flag reference, per-command usage, and Railway instructions: [`docs/guide/cli.md`](docs/guide/cli.md).

## Roadmap

🚧 **Sub-agents & Workflow Builder** — Compose multi-step agent workflows with branching and handoffs

🚧 **OTEL + A/B Testing via Langfuse** — OpenTelemetry traces, prompt variant experiments, side-by-side comparison

🚧 **Agentic Insights** — Custom funnels tracking agent behavior through business-defined conversion paths

🚧 **Closed-loop instruction tuning** — turn repeated eval and simulation failures into suggested SOP, guardrail, and instruction fixes

📋 **More Blueprints** — Contact center ships first; healthcare intake, field service, B2B sales next

📋 **Connector Marketplace** — Community-built integrations

## Deployment

Docker Compose for local and staging (`make docker-up`), Railway for production. The Railway architecture is PostgreSQL + API + UI + Caddy load balancer (the LB is the only public-facing service, routing `/api/*` and `/mcp` to the API and everything else to the UI over Railway's internal network). Config is as-code via `railway.toml` per service — full setup and deploy steps in [`railway/DEPLOY.md`](railway/DEPLOY.md).

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

Production foundations include RBAC with separate admin/support/agent auth paths, encrypted secrets, row-level security, and a full CI pipeline running lint, typecheck, unit, integration, and MCP-protocol tests on every PR. See [ADR-005](docs/decisions/005-sops-as-core-primitive.md) for the SOP primitive, [ADR-007](docs/decisions/007-evaluation-engine.md) and [ADR-009](docs/decisions/009-eval-suites.md) for the evals engine.

## Documentation

| Resource | Description |
|----------|-------------|
| [MCP Integration Guide](docs/guide/mcp-integration.md) | Connect your AI agent via MCP |
| [Admin Guide](docs/guide/admin-guide.md) | Configure connectors, agents, and tools through the dashboard |
| [Adding a Connector](docs/guide/adding-a-connector.md) | Build a new connector manifest, handlers, and tests |
| [`mg` CLI — Onboarding](docs/guide/cli.md) | Provision organizations from YAML |
| [Seed Data](docs/guide/seed-data.md) | Dev accounts, orgs, and session scenarios |
| [Architecture Decisions](docs/decisions/) | ADRs for significant design choices |
| [Deployment Guide](railway/DEPLOY.md) | Railway production deployment |
| [Contributing](CONTRIBUTING.md) | Setup, workflow, project structure, conventions |

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
  Built by <a href="https://modelguide.ai">ModelGuide</a> · The open-source orchestration framework for production voice-first agents · 🇵🇱 Poland
</p>
