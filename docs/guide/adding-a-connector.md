# Adding a Connector

Connectors bridge ModelGuide to external business systems (e-commerce, helpdesk, calendars, CRMs). Each connector is a TypeScript module that ships with its own manifest, tool definitions, and handlers. Once registered, its tools become assignable to any agent in any organization.

This guide walks through creating a new connector from scratch.

## Anatomy of a connector

A connector lives in `modelguide-api/src/features/connectors/catalog/<slug>/`. The minimum layout:

```
catalog/yourservice/
├── index.ts          # Manifest + tool handlers
└── tools/            # Optional — split handlers into separate files
```

The manifest describes the connector (name, slug, config schema, auth methods) and its tools. Each tool has a catalog entry (name, description, JSON Schema input, confirmation/timeout defaults) and a handler function that receives resolved config + validated input.

## 1. Create the manifest

Create `modelguide-api/src/features/connectors/catalog/yourservice/index.ts`:

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
        const response = await fetch(
          `${ctx.config.apiUrl}/things/${ctx.input.thingId}`,
          {
            headers: { Authorization: `Bearer ${ctx.config.apiKey}` },
          },
        );
        return { success: true, data: await response.json() };
      },
    },
  ],
};

export default manifest;
```

### Config schema

- `type: "string"` — plain config value, stored as-is
- `type: "secret"` — references a secret UUID, resolved at execution time and decrypted from AES-256-GCM storage
- `required: true` — validation fails at instance creation if missing

### Tool catalog entry

| Field | Purpose |
|---|---|
| `name` | Human-readable label shown in the dashboard |
| `description` | Sent to the LLM — make it precise and voice-friendly |
| `inputSchema` | JSON Schema; converted to Zod at MCP handler time for validation |
| `defaultRequiresConfirmation` | If true, the agent must confirm with the user before the tool executes |
| `defaultTimeoutSeconds` | Default per-call timeout, overridable per agent assignment |

### Handler contract

```typescript
handler: async (ctx: ToolContext) => ToolResult
```

- `ctx.config` — the connector instance config with all secrets already resolved
- `ctx.input` — the validated input matching `inputSchema`
- Return shape is `{ success: true, data: ... }` or `{ success: false, error: ... }`

Throw errors freely — the MCP handler catches, logs, and surfaces them as structured tool errors to the agent.

## 2. Register the connector

Add your module to the catalog registry:

```typescript
// modelguide-api/src/features/connectors/catalog/registry.ts
const modules = await Promise.all([
  import("./medusa/index"),
  import("./zendesk/index"),
  import("./yourservice/index"),  // add this
]);
```

The registry is loaded at boot and drives both the `connectors_catalog` DB table and the runtime tool router.

## 3. Sync and verify

Run:

```bash
make sync-connectors
```

This upserts the catalog into the database. Your new connector now appears in the dashboard catalog, and admins can create instances by providing the required config/secrets. Once an instance is configured, its tools become assignable to any agent.

Verify in the dashboard (`http://localhost:3001`):

1. **Connectors → Catalog** — your connector appears with the right name, description, and icon
2. **Connectors → Instances** — create a test instance with config values
3. **Agents → Tools** — assign one of your tools to a test agent
4. **MCP** — call `tools/list` with the agent's API key and verify the tool is returned

## Voice-first tool design

Tool responses flow directly into the LLM's context on every call — for voice agents with ~10s turn budgets, response size directly maps to TTFT and cost. ModelGuide's response trimmer (`modelguide-api/src/features/connectors/catalog/lib/response-trimmer.ts`) strips noise from upstream JSON, but design the tool for voice too:

- **Return only what the LLM needs** — product IDs, not full variants; order status, not full shipping history
- **Prefer IDs over enriched objects** — let the LLM call a second tool for details if the user asks
- **Keep descriptions short** — the description is read on every `tools/list`, and verbose wording bloats every conversation
- **Name fields for the LLM** — use `order_id` not `orderIdentifier`, use `customer_email` not `emailAddress`

## Testing

Add unit tests for handlers under `modelguide-api/tests/unit/connectors/yourservice/`:

```typescript
import { describe, expect, it } from "bun:test";
import manifest from "@features/connectors/catalog/yourservice/index";

describe("yourservice connector", () => {
  it("exposes the expected tool catalog", () => {
    expect(manifest.slug).toBe("yourservice");
    expect(manifest.tools.map((t) => t.catalog.name)).toContain("Do Thing");
  });
});
```

For handler tests, mock `fetch` with `bun:test` mocks or inject a client into the handler factory.

## Tool naming

Tools are exposed to agents as `{connector_slug}_{tool_name_snakecased}`. For a `yourservice` connector with a "Do Thing" tool, the MCP tool name is `yourservice_do_thing`. Agents see these names in `tools/list`, and the dashboard uses them everywhere tools are listed.

## See also

- [Admin Guide](admin-guide.md) — configuring connector instances and assigning tools to agents
- [MCP Integration Guide](mcp-integration.md) — how voice agents consume connector tools
- [`modelguide-api/src/features/connectors/catalog/medusa/`](../../modelguide-api/src/features/connectors/catalog/medusa/) — reference implementation
- [`modelguide-api/src/features/connectors/catalog/zendesk/`](../../modelguide-api/src/features/connectors/catalog/zendesk/) — second reference implementation
