# Seed Data

`make db-seed` (run automatically by `make quickstart`) populates three industry-vertical organizations that demonstrate ModelGuide across very different customer-support shapes. Everything in the seed is config-driven — each vertical is a single TypeScript file under `modelguide-api/src/db/seed/verticals/`.

Use the seed to explore the dashboard, run the reference voice agents against realistic data, or reproduce the "happy path" for demos without hand-configuring anything.

## What gets created

Each org gets:

- Both **Medusa** (e-commerce) and **Zendesk** (helpdesk) connector instances
- Two agents (support + voice), each with API keys and connector-tool assignments
- ~300 generated sessions with tool calls, per-message cost tracking, and SOP classification
- Handwritten showcase conversations with edge cases (escalations, guardrail trips, happy paths)
- SOP templates in the global catalog + demo SOP definitions assigned to agents
- Guardrail rules matched to SOPs at compile time

## Organizations

| Organization | Slug | Industry | Use Case | Channel Mix |
|---|---|---|---|---|
| **GlowBox Beauty** | `glowbox` | Retail / Beauty | "Where is my order?" + product recommendations | Web-dominant |
| **ClearHealth** | `clearhealth` | Medical Call Center | Patient support — Rx refills, appointment scheduling, insurance questions, lab results | Voice-dominant |
| **SteelPoint Supply** | `steelpoint` | B2B Industrial | Quotes, bulk orders, technical specs, delivery scheduling | Email/Slack-heavy |

GlowBox is the default demo org — it's the target for the reference voice agent examples and has the viewer account enabled for instant read-only login without a magic link round-trip.

## Session scenarios

The session generator produces eight scenario types, distributed per org with weights matching the vertical's real-world channel mix:

1. **Product inquiry** — catalog search, availability questions
2. **Purchase flow** — add to cart, apply discount, checkout assistance
3. **Order status** — "where is my order", tracking, delivery estimates
4. **Return / exchange** — initiate returns, RMA lookup, refund status
5. **Ticket lookup** — find existing support tickets
6. **Ticket creation** — escalate to a human agent
7. **Ticket escalation** — hand off already-open tickets to a specialist
8. **General questions** — policies, hours, contact info

Each scenario pulls from industry-appropriate products, ticket templates, and conversation language — GlowBox talks about mascara, ClearHealth talks about prescriptions, SteelPoint talks about structural steel.

## Dev accounts

Authentication uses **magic links** — enter the email, and the login link is printed to the API server console. No email provider needed in dev.

| Org | Admin | Support | Viewer |
|---|---|---|---|
| GlowBox | `delivered+admin-glowbox@resend.dev` | `delivered+support-glowbox@resend.dev` | `delivered+viewer-glowbox@resend.dev` |
| ClearHealth | `delivered+admin-clearhealth@resend.dev` | `delivered+support-clearhealth@resend.dev` | `delivered+viewer-clearhealth@resend.dev` |
| SteelPoint | `delivered+admin-steelpoint@resend.dev` | `delivered+support-steelpoint@resend.dev` | `delivered+viewer-steelpoint@resend.dev` |

Role permissions:

- **Admin** — full org access, can manage connectors, secrets, agents, SOPs, users, deployment
- **Support** — read sessions, transcripts, analytics; write QA tags and feedback; no infrastructure access
- **Viewer** — read-only across the dashboard, no QA tag writes

All three GlowBox accounts are preconfigured as demo accounts for the instant-login flow.

## Adding a new vertical

The seed is structured so adding a new organization means creating one new file and one import line:

1. Create `modelguide-api/src/db/seed/verticals/<slug>.ts` with your org config — name, industry, channel mix, connector instances, agents, session weights
2. Import and register it in `modelguide-api/src/db/seed/index.ts`
3. Run `make db-seed` (destructive — drops and recreates all seed data)

Look at `glowbox.ts`, `clearhealth.ts`, and `steelpoint.ts` as references. The types in `modelguide-api/src/db/seed/types.ts` show the full vertical contract — anything you skip uses defaults.

## Resetting the seed

`make db-seed` is destructive — it drops and recreates all seed-managed rows. Run it whenever you want a clean state, after schema migrations, or after experimenting with dashboard changes you don't want to keep.

For a full reset (including schema):

```bash
make db-down
make db-up
make db-migrate
make db-seed
```

## See also

- [Admin Guide](admin-guide.md) — navigate the dashboard once the seed is loaded
- [MCP Integration Guide](mcp-integration.md) — point a voice agent at the seeded GlowBox agent
- [`modelguide-api/src/db/seed/`](../../modelguide-api/src/db/seed/) — full seed source
