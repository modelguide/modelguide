---
name: mg-connector
description: Use when the user asks to add a connector, create a connector, implement a connector for a service, add a tool to a connector, update a connector tool, or asks about connector architecture. Trigger phrases include "add connector", "create connector", "new connector", "implement connector", "add tool to connector", "update connector tool", "connector architecture".
---

# Connector Development Skill

Guide for creating, extending, and maintaining connector modules in the ModelGuide platform. Connectors integrate external services (e-commerce, helpdesk, calendars) into the platform, exposing their capabilities as tools that AI agents invoke via MCP.

## Architecture Overview

### The 3-File Module Pattern

Every connector lives at `modelguide-api/src/features/connectors/catalog/{slug}/` and consists of exactly three files:

| File | Purpose |
|------|---------|
| `client.ts` | HTTP client factory bound to connector config. Custom error class + typed fetcher. |
| `handlers.ts` | Tool execution functions. Each handler is wrapped in an error-handling HOF. |
| `index.ts` | Manifest: connector metadata + tool definitions array. Default export is `ConnectorManifest`. |

### System Flow

```
code manifest → registry.ts → sync.ts → DB connectors_catalog
                                          ↓
                              org creates connector instance (with config/secrets)
                                          ↓
                              AI agent calls tool via MCP → handler executes with resolved config
```

### Key Type Contracts

All types are in `modelguide-api/src/features/connectors/catalog/types.ts`:

```ts
interface ToolExecutionContext {
  config: Record<string, string>;   // resolved config (secrets decrypted)
  input: Record<string, unknown>;   // validated tool input from MCP call
  organizationId: string;
  connectorId: string;
}

interface ToolExecutionResult {
  success: boolean;
  data?: Record<string, unknown>;
  error?: string;
}

interface ConnectorToolDefinition {
  catalog: CatalogTool;             // metadata stored in DB
  handler: (ctx: ToolExecutionContext) => Promise<ToolExecutionResult>;
}

interface ConfigFieldSchema {
  type: "string" | "secret" | "number" | "boolean";
  required: boolean;
  description: string;
  default?: string | number | boolean;
}

type ConnectorType = "api" | "webhook" | "database" | "messaging";

interface ConnectorManifest {
  name: string;                     // Human-readable, e.g. "Medusa"
  slug: string;                     // URL-safe unique ID, e.g. "medusa"
  description: string;
  connectorType: ConnectorType;
  configSchema: Record<string, ConfigFieldSchema>;
  authMethods: string[];            // e.g. ["api_key"], ["oauth2"], ["bearer_token"]
  iconUrl: string;
  tools: ConnectorToolDefinition[];
}
```

`CatalogTool` (from `@db/schema/core`):

```ts
interface CatalogTool {
  name: string;                        // Human-readable, e.g. "List Products"
  description: string;
  inputSchema: Record<string, unknown>; // JSON Schema
  defaultRequiresConfirmation: boolean;
  defaultTimeoutSeconds: number;
}
```

---

## Creating a New Connector

### Step 0: Gather Requirements

Ask the user for:
- **Service name** and **slug** (lowercase, alphanumeric + hyphens)
- **Description** of what the connector does
- **Connector type**: `api` | `webhook` | `database` | `messaging`
- **Config fields**: what the connector needs (base URL, API key, etc.)
- **Auth method**: `api_key`, `oauth2`, `bearer_token`, etc.
- **Initial tools**: list of operations to expose

### Step 1: Create `client.ts`

```ts
// modelguide-api/src/features/connectors/catalog/{slug}/client.ts

interface {Name}FetchOptions {
  method?: string;
  body?: Record<string, unknown>;
  params?: Record<string, string | number | undefined>;
}

export class {Name}ApiError extends Error {
  constructor(
    public status: number,
    public body: string,
  ) {
    super(`{Name} API error ${status}: ${body}`);
    this.name = "{Name}ApiError";
  }
}

export type {Name}Fetcher = <T = unknown>(
  path: string,
  options?: {Name}FetchOptions,
) => Promise<T>;

export function create{Name}Fetcher(
  config: Record<string, string>,
): {Name}Fetcher {
  const baseUrl = config.baseUrl?.replace(/\/+$/, "");
  if (!baseUrl) {
    throw new Error("{Name} baseUrl is required");
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  // Add auth headers based on the service's auth method
  if (config.apiKey) {
    headers["Authorization"] = `Bearer ${config.apiKey}`;
  }

  return async function fetch<T = unknown>(
    path: string,
    options?: {Name}FetchOptions,
  ): Promise<T> {
    const { method = "GET", body, params } = options ?? {};

    let url = `${baseUrl}${path}`;
    if (params) {
      const entries = Object.entries(params).filter(([, v]) => v !== undefined);
      if (entries.length > 0) {
        const qs = new URLSearchParams(entries.map(([k, v]) => [k, String(v)]));
        url += `?${qs}`;
      }
    }

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new {Name}ApiError(response.status, text);
    }

    return response.json() as Promise<T>;
  };
}
```

**Important:** The inner function name must NOT shadow `globalThis.fetch`. Use a distinct name like `{slug}Fetch` (e.g. `medusaFetch`).

### Step 2: Create `handlers.ts`

```ts
// modelguide-api/src/features/connectors/catalog/{slug}/handlers.ts

import type { ToolExecutionContext, ToolExecutionResult } from "../types";
import {
  {Name}ApiError,
  type {Name}Fetcher,
  create{Name}Fetcher,
} from "./client";

function errorResult(err: unknown): ToolExecutionResult {
  if (err instanceof {Name}ApiError) {
    return { success: false, error: `{Name} API ${err.status}: ${err.body}` };
  }
  const message = err instanceof Error ? err.message : String(err);
  return { success: false, error: message };
}

/**
 * Wraps a handler so every tool gets a fetcher and consistent error handling.
 */
function with{Name}(
  fn: (
    fetcher: {Name}Fetcher,
    ctx: ToolExecutionContext,
  ) => Promise<ToolExecutionResult>,
): (ctx: ToolExecutionContext) => Promise<ToolExecutionResult> {
  return async function handler(ctx) {
    try {
      const fetcher = create{Name}Fetcher(ctx.config);
      return await fn(fetcher, ctx);
    } catch (err) {
      return errorResult(err);
    }
  };
}

// Export one handler per tool:
export const listSomething = with{Name}(async (fetcher, ctx) => {
  const input = ctx.input as { /* typed input */ };
  const data = await fetcher<Record<string, unknown>>("/api/endpoint", {
    params: { /* query params */ },
  });
  return { success: true, data };
});
```

**Rules:**
- Never throw from handlers — always return `{ success: false, error }` via the wrapper
- Type-cast `ctx.input` to the expected shape matching the tool's `inputSchema`
- Use the `with{Name}()` wrapper for every exported handler

### Step 3: Create `index.ts`

```ts
// modelguide-api/src/features/connectors/catalog/{slug}/index.ts

import type { ConnectorManifest, ConnectorToolDefinition } from "../types";
import { listSomething } from "./handlers";

const tools: ConnectorToolDefinition[] = [
  {
    catalog: {
      name: "List Something",                    // Human-readable
      description: "Description of what this tool does",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query" },
          limit: { type: "integer", description: "Max results", minimum: 1, maximum: 100 },
        },
        required: [],
      },
      defaultRequiresConfirmation: false,       // true for side effects
      defaultTimeoutSeconds: 30,                // 30 for reads, 60 for writes
    },
    handler: listSomething,
  },
];

const {slug}Manifest: ConnectorManifest = {
  name: "{Display Name}",
  slug: "{slug}",
  description: "...",
  connectorType: "api",
  configSchema: {
    baseUrl: {
      type: "string",
      required: true,
      description: "API base URL",
    },
    apiKey: {
      type: "secret",                           // encrypted in secrets table
      required: true,
      description: "API key for authentication",
    },
  },
  authMethods: ["api_key"],
  iconUrl: "https://example.com/icon.svg",
  tools,
};

export default {slug}Manifest;
```

### Step 4: Register in Registry

Add the new connector import to `modelguide-api/src/features/connectors/catalog/registry.ts`:

```ts
export async function loadAllManifests(): Promise<ConnectorManifest[]> {
  const modules = await Promise.all([
    import("./medusa/index"),
    import("./{slug}/index"),     // ← add new import here
  ]);
  // ...
}
```

### Step 5: Create Unit Tests

Create `modelguide-api/tests/unit/connectors/{slug}-handlers.test.ts`:

```ts
import { afterAll, describe, expect, mock, test } from "bun:test";
import {
  listSomething,
} from "@features/connectors/catalog/{slug}/handlers";
import type { ToolExecutionContext } from "@features/connectors/catalog/types";

const BASE_CONFIG: Record<string, string> = {
  baseUrl: "https://api.test-service.com",
  apiKey: "test_key_123",
};

function makeCtx(
  input: Record<string, unknown> = {},
  config = BASE_CONFIG,
): ToolExecutionContext {
  return {
    config,
    input,
    organizationId: "org-1",
    connectorId: "conn-1",
  };
}

const originalFetch = globalThis.fetch;
let fetchMock: ReturnType<typeof mock>;

function mockFetchSuccess(responseData: Record<string, unknown>) {
  fetchMock = mock(() =>
    Promise.resolve(
      new Response(JSON.stringify(responseData), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ),
  );
  globalThis.fetch = fetchMock as typeof fetch;
}

function mockFetchError(status: number, body: string) {
  fetchMock = mock(() => Promise.resolve(new Response(body, { status })));
  globalThis.fetch = fetchMock as typeof fetch;
}

afterAll(() => {
  globalThis.fetch = originalFetch;
});

describe("{Name} handlers", () => {
  describe("listSomething", () => {
    test("calls GET /api/endpoint", async () => {
      mockFetchSuccess({ items: [] });
      const result = await listSomething(makeCtx());
      expect(result.success).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      const [url, opts] = fetchMock.mock.calls[0];
      expect(url).toContain("/api/endpoint");
      expect(opts.method).toBe("GET");
    });
  });

  describe("error handling", () => {
    test("returns error on API 404", async () => {
      mockFetchError(404, '{"message":"Not found"}');
      const result = await listSomething(makeCtx({ id: "bad" }));
      expect(result.success).toBe(false);
      expect(result.error).toContain("404");
    });

    test("returns error when baseUrl is missing", async () => {
      const result = await listSomething(makeCtx({}, { apiKey: "key" }));
      expect(result.success).toBe(false);
      expect(result.error).toContain("baseUrl");
    });

    test("returns error on network failure", async () => {
      fetchMock = mock(() => Promise.reject(new Error("Network error")));
      globalThis.fetch = fetchMock as typeof fetch;
      const result = await listSomething(makeCtx());
      expect(result.success).toBe(false);
      expect(result.error).toContain("Network error");
    });
  });
});
```

### Step 6: Verify

```bash
make api-typecheck     # must pass
make api-test-unit     # must pass
```

### Step 7: Sync to Database

```bash
cd modelguide-api && bun run src/features/connectors/catalog/sync.ts
```

---

## Adding Tools to an Existing Connector

1. **Read** the existing manifest (`index.ts`) and handlers (`handlers.ts`) to understand current tools
2. **Add handler** in `handlers.ts` using the existing `with{Name}()` wrapper
3. **Add tool definition** to the `tools` array in `index.ts` with full `catalog` metadata
4. **Add tests** for the new handler in the existing test file
5. **Run** `make api-typecheck && make api-test-unit`
6. **Sync** to update the DB catalog

---

## Modifying Existing Tools

1. **Read** the current tool definition in `index.ts` and its handler in `handlers.ts`
2. **Update `inputSchema`** if changing inputs (JSON Schema format)
3. **Update handler** logic in `handlers.ts`
4. **Update `defaultRequiresConfirmation`** / **`defaultTimeoutSeconds`** if behavior changed
5. **Update tests** in the corresponding test file
6. **Run** `make api-typecheck && make api-test-unit`
7. **Sync** to push changes to the DB

---

## Standards & Conventions

### Naming
- **Tool names**: Human-readable in `catalog.name` (e.g. "List Products")
- **Tool slugs**: Auto-derived from name as snake_case (e.g. "list_products")
- **MCP tool names**: `{connectorSlug}_{toolSlug}` (e.g. "medusa_list_products")

### Error Handling
- Always use the `with{Name}()` HOF wrapper — never throw from handlers
- Return `{ success: false, error: "message" }` on failure
- The wrapper catches exceptions from the client and formats them consistently

### Input Schemas
- JSON Schema format with `type`, `properties`, `required`
- Add `description` on every property
- Use `minimum`/`maximum` for numeric bounds
- Nested objects are supported (see Medusa's `setDeliveryAddress`)

### Config Schema
- `type: "string"` — plain text config (base URLs, region codes)
- `type: "secret"` — encrypted in the `secrets` table, resolved at runtime
- `type: "number"` — numeric config
- `type: "boolean"` — feature flags

### Confirmation & Timeouts
- `defaultRequiresConfirmation: true` for side effects: orders, payments, deletions, state mutations
- `defaultRequiresConfirmation: false` for read-only operations
- `defaultTimeoutSeconds: 30` for reads
- `defaultTimeoutSeconds: 60` for writes and complex operations

### Client Pattern
- Factory function scoped to config: `create{Name}Fetcher(config)`
- Custom error class: `{Name}ApiError` with `status` and `body`
- Consistent headers (Content-Type, Accept, auth)
- Strip trailing slashes from base URL
- Inner fetch function name must NOT shadow `globalThis.fetch`

---

## Key Reference Files

| Purpose | Path |
|---------|------|
| Type contracts | `modelguide-api/src/features/connectors/catalog/types.ts` |
| Registry | `modelguide-api/src/features/connectors/catalog/registry.ts` |
| Sync script | `modelguide-api/src/features/connectors/catalog/sync.ts` |
| DB schema (CatalogTool) | `modelguide-api/src/db/schema/core.ts` |
| Medusa manifest | `modelguide-api/src/features/connectors/catalog/medusa/index.ts` |
| Medusa handlers | `modelguide-api/src/features/connectors/catalog/medusa/handlers.ts` |
| Medusa client | `modelguide-api/src/features/connectors/catalog/medusa/client.ts` |
| Medusa tests | `modelguide-api/tests/unit/connectors/medusa-handlers.test.ts` |
| Connector service | `modelguide-api/src/features/connectors/connectors.service.ts` |
| MCP handler | `modelguide-api/src/features/mcp/mcp.handler.ts` |
| MCP service | `modelguide-api/src/features/mcp/mcp.service.ts` |
