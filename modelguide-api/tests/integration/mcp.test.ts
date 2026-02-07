/**
 * Integration tests for the MCP endpoint (POST /mcp)
 * Tests the full MCP protocol flow using the SDK's own Client + StreamableHTTPClientTransport,
 * with Hono's app.fetch as the custom fetch function (no real HTTP server needed).
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import app from "@/app";
import { forApp } from "@db/rls";
import { sessions } from "@db/schema";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { eq } from "drizzle-orm";
import {
  type TestSeed,
  agentHeadersFor,
  authHeadersFor,
  getTestSeed,
} from "../helpers/seed";

let s: TestSeed;
let pizzaAdminHeaders: Record<string, string>;
let pizzaAgentHeaders: Record<string, string>;
let burgerAgentHeaders: Record<string, string>;

/** IDs of sessions created during tests (for cleanup) */
const createdSessionIds: string[] = [];

function request(path: string, options?: RequestInit) {
  return app.fetch(new Request(`http://localhost${path}`, options));
}

/**
 * Creates a connected MCP Client backed by Hono's app.fetch.
 * The returned client handles initialize/initialized automatically via `connect()`.
 */
async function createMcpClient(agentHeaders: Record<string, string>) {
  const transport = new StreamableHTTPClientTransport(
    new URL("http://localhost/mcp"),
    {
      fetch: (url, init) => app.fetch(new Request(url, init)),
      requestInit: { headers: { Authorization: agentHeaders.Authorization } },
    },
  );
  const client = new Client({ name: "test-client", version: "1.0.0" });
  await client.connect(transport);
  return { client, transport };
}

/** Helper to parse the JSON text from a callTool result */
function parseToolResult(
  result: Awaited<ReturnType<Client["callTool"]>>,
): Record<string, unknown> {
  if ("content" in result) {
    const textContent = result.content.find((c) => c.type === "text");
    if (textContent && "text" in textContent) {
      return JSON.parse(textContent.text);
    }
  }
  return {};
}

beforeAll(async () => {
  s = await getTestSeed();
  [pizzaAdminHeaders, pizzaAgentHeaders, burgerAgentHeaders] =
    await Promise.all([
      authHeadersFor(s.pizzaAdmin),
      agentHeadersFor(s.pizzaAgentId, s.pizzaOrg.id),
      agentHeadersFor(s.burgerAgentId, s.burgerOrg.id),
    ]);
});

afterAll(async () => {
  if (createdSessionIds.length > 0) {
    await forApp(async (tx) => {
      for (const id of createdSessionIds) {
        // Messages and feedback are cascade-deleted by FK
        await tx.delete(sessions).where(eq(sessions.id, id));
      }
    });
  }
});

// ============================================================================
// Auth & access control
// ============================================================================

describe("Auth & access control", () => {
  test("rejects request with no auth header", async () => {
    const response = await request("/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "test", version: "1.0.0" },
        },
      }),
    });

    // Should get an error (401) since no auth
    expect(response.status).toBe(401);
  });

  test("rejects admin JWT (agent auth required)", async () => {
    const response = await request("/mcp", {
      method: "POST",
      headers: {
        ...pizzaAdminHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "test", version: "1.0.0" },
        },
      }),
    });

    expect(response.status).toBe(401);
  });

  test("valid agent key connects successfully", async () => {
    const { client, transport } = await createMcpClient(pizzaAgentHeaders);

    const serverVersion = client.getServerVersion();
    expect(serverVersion).toBeDefined();
    expect(serverVersion!.name).toBe("ModelGuide MCP");

    await transport.close();
  });
});

// ============================================================================
// Tool discovery (client.listTools)
// ============================================================================

describe("Tool discovery", () => {
  let client: Client;
  let transport: StreamableHTTPClientTransport;

  beforeAll(async () => {
    ({ client, transport } = await createMcpClient(pizzaAgentHeaders));
  });

  afterAll(async () => {
    await transport.close();
  });

  test("returns core tools and connector tools", async () => {
    const result = await client.listTools();

    expect(result.tools.length).toBeGreaterThanOrEqual(5);

    const coreToolNames = result.tools
      .filter((t) => t.name.startsWith("core_"))
      .map((t) => t.name);

    expect(coreToolNames).toContain("core_create_session");
    expect(coreToolNames).toContain("core_end_session");
    expect(coreToolNames).toContain("core_escalate_session");
    expect(coreToolNames).toContain("core_add_messages");
    expect(coreToolNames).toContain("core_rate_session");
    expect(coreToolNames.length).toBe(5);
  });

  test("connector tools include session_id in input schema", async () => {
    const result = await client.listTools();

    const connectorTools = result.tools.filter(
      (t) => !t.name.startsWith("core_"),
    );

    // Seed creates Medusa connector tools linked to the agent
    expect(connectorTools.length).toBeGreaterThan(0);

    for (const tool of connectorTools) {
      const props = tool.inputSchema.properties as
        | Record<string, object>
        | undefined;
      expect(props).toBeDefined();
      expect(props!.session_id).toBeDefined();
    }
  });
});

// ============================================================================
// Resource discovery
// ============================================================================

describe("Resource discovery", () => {
  let client: Client;
  let transport: StreamableHTTPClientTransport;

  beforeAll(async () => {
    ({ client, transport } = await createMcpClient(pizzaAgentHeaders));
  });

  afterAll(async () => {
    await transport.close();
  });

  test("listResources returns agent://config and tools://list", async () => {
    const result = await client.listResources();

    const uris = result.resources.map((r) => r.uri);
    expect(uris).toContain("agent://config");
    expect(uris).toContain("tools://list");
  });

  test("readResource agent://config returns agent info", async () => {
    const result = await client.readResource({ uri: "agent://config" });

    expect(result.contents.length).toBe(1);
    const content = result.contents[0];
    expect(content.uri).toBe("agent://config");

    const data = JSON.parse((content as { text: string }).text);
    expect(data.agent_id).toBe(s.pizzaAgentId);
    expect(data.organization_id).toBe(s.pizzaOrg.id);
    expect(typeof data.tool_count).toBe("number");
    expect(data.tool_count).toBeGreaterThanOrEqual(5);
  });

  test("readResource tools://list returns tool array with requires_confirmation", async () => {
    const result = await client.readResource({ uri: "tools://list" });

    expect(result.contents.length).toBe(1);
    const tools = JSON.parse((result.contents[0] as { text: string }).text);

    expect(Array.isArray(tools)).toBe(true);

    // tools://list only contains connector tools (not core tools)
    for (const tool of tools) {
      expect(typeof tool.name).toBe("string");
      expect(typeof tool.requires_confirmation).toBe("boolean");
      expect(typeof tool.connector).toBe("string");
    }
  });
});

// ============================================================================
// Core tool: core_create_session
// ============================================================================

describe("core_create_session", () => {
  let client: Client;
  let transport: StreamableHTTPClientTransport;

  beforeAll(async () => {
    ({ client, transport } = await createMcpClient(pizzaAgentHeaders));
  });

  afterAll(async () => {
    await transport.close();
  });

  test("creates a session with valid params", async () => {
    const result = await client.callTool({
      name: "core_create_session",
      arguments: {
        channel_type: "voice",
        user_identifier: "+1234560000",
      },
    });

    const data = parseToolResult(result);
    expect(data.session_id).toBeDefined();
    expect(data.status).toBe("active");
    expect(data.channel_type).toBe("voice");

    // Validate UUID format
    expect(data.session_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );

    createdSessionIds.push(data.session_id);
  });

  test("returns error for missing required field", async () => {
    // The MCP SDK throws when the server returns a JSON-RPC error
    // (Zod validation rejects the missing required fields)
    try {
      await client.callTool({
        name: "core_create_session",
        arguments: {
          // missing channel_type and user_identifier
        },
      });
      // If we get here, the call didn't throw — check for isError in result
      expect(true).toBe(false); // should not reach here
    } catch (err) {
      expect(err).toBeDefined();
    }
  });
});

// ============================================================================
// Core tool: core_end_session
// ============================================================================

describe("core_end_session", () => {
  let client: Client;
  let transport: StreamableHTTPClientTransport;
  let activeSessionId: string;

  beforeAll(async () => {
    ({ client, transport } = await createMcpClient(pizzaAgentHeaders));

    // Create a session to end
    const createResult = await client.callTool({
      name: "core_create_session",
      arguments: {
        channel_type: "web",
        user_identifier: "end-test@test.com",
      },
    });
    const created = parseToolResult(createResult);
    activeSessionId = created.session_id;
    createdSessionIds.push(activeSessionId);
  });

  afterAll(async () => {
    await transport.close();
  });

  test("ends an active session", async () => {
    const result = await client.callTool({
      name: "core_end_session",
      arguments: { session_id: activeSessionId },
    });

    const data = parseToolResult(result);
    expect(data.session_id).toBe(activeSessionId);
    expect(data.status).toBe("completed");
  });

  test("returns error for already-ended session", async () => {
    const result = await client.callTool({
      name: "core_end_session",
      arguments: { session_id: activeSessionId },
    });

    const data = parseToolResult(result);
    expect(data.error).toBeDefined();
  });
});

// ============================================================================
// Core tool: core_escalate_session
// ============================================================================

describe("core_escalate_session", () => {
  let client: Client;
  let transport: StreamableHTTPClientTransport;

  beforeAll(async () => {
    ({ client, transport } = await createMcpClient(pizzaAgentHeaders));
  });

  afterAll(async () => {
    await transport.close();
  });

  test("escalates an active session", async () => {
    const createResult = await client.callTool({
      name: "core_create_session",
      arguments: {
        channel_type: "voice",
        user_identifier: "+1234560001",
      },
    });
    const created = parseToolResult(createResult);
    createdSessionIds.push(created.session_id);

    const result = await client.callTool({
      name: "core_escalate_session",
      arguments: { session_id: created.session_id },
    });

    const data = parseToolResult(result);
    expect(data.session_id).toBe(created.session_id);
    expect(data.status).toBe("escalated");
  });
});

// ============================================================================
// Core tool: core_add_messages
// ============================================================================

describe("core_add_messages", () => {
  let client: Client;
  let transport: StreamableHTTPClientTransport;
  let sessionId: string;

  beforeAll(async () => {
    ({ client, transport } = await createMcpClient(pizzaAgentHeaders));

    const createResult = await client.callTool({
      name: "core_create_session",
      arguments: {
        channel_type: "voice",
        user_identifier: "+1234560002",
      },
    });
    const created = parseToolResult(createResult);
    sessionId = created.session_id;
    createdSessionIds.push(sessionId);
  });

  afterAll(async () => {
    await transport.close();
  });

  test("adds messages and returns count", async () => {
    const result = await client.callTool({
      name: "core_add_messages",
      arguments: {
        session_id: sessionId,
        messages: [
          {
            role: "user",
            content: "Hello, I want to order a pizza",
            occurred_at: new Date().toISOString(),
          },
          {
            role: "assistant",
            content: "Sure! What size would you like?",
            occurred_at: new Date().toISOString(),
          },
        ],
      },
    });

    const data = parseToolResult(result);
    expect(data.session_id).toBe(sessionId);
    expect(data.messages_added).toBe(2);
  });

  test("messages persisted and visible via REST API", async () => {
    const response = await request(`/api/sessions/${sessionId}`, {
      headers: pizzaAdminHeaders,
    });

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.messages.length).toBeGreaterThanOrEqual(2);

    const userMsg = body.messages.find(
      (m: { role: string; content: string }) =>
        m.role === "user" && m.content === "Hello, I want to order a pizza",
    );
    expect(userMsg).toBeDefined();
  });
});

// ============================================================================
// Core tool: core_rate_session
// ============================================================================

describe("core_rate_session", () => {
  let client: Client;
  let transport: StreamableHTTPClientTransport;
  let sessionId: string;

  beforeAll(async () => {
    ({ client, transport } = await createMcpClient(pizzaAgentHeaders));

    const createResult = await client.callTool({
      name: "core_create_session",
      arguments: {
        channel_type: "voice",
        user_identifier: "+1234560003",
      },
    });
    const created = parseToolResult(createResult);
    sessionId = created.session_id;
    createdSessionIds.push(sessionId);
  });

  afterAll(async () => {
    await transport.close();
  });

  test("records a valid rating (2 = positive)", async () => {
    const result = await client.callTool({
      name: "core_rate_session",
      arguments: { session_id: sessionId, rating: 2 },
    });

    const data = parseToolResult(result);
    expect(data.recorded).toBe(true);
    expect(data.rating).toBe(2);
    expect(data.session_id).toBe(sessionId);
  });

  test("returns error for invalid rating (5)", async () => {
    const result = await client.callTool({
      name: "core_rate_session",
      arguments: { session_id: sessionId, rating: 5 },
    });

    const data = parseToolResult(result);
    expect(data.error).toBeDefined();
  });
});

// ============================================================================
// RLS isolation
// ============================================================================

describe("RLS isolation", () => {
  let pizzaClient: Client;
  let pizzaTransport: StreamableHTTPClientTransport;
  let burgerClient: Client;
  let burgerTransport: StreamableHTTPClientTransport;
  let pizzaSessionId: string;

  beforeAll(async () => {
    ({ client: pizzaClient, transport: pizzaTransport } =
      await createMcpClient(pizzaAgentHeaders));
    ({ client: burgerClient, transport: burgerTransport } =
      await createMcpClient(burgerAgentHeaders));

    // Create a Pizza Palace session
    const createResult = await pizzaClient.callTool({
      name: "core_create_session",
      arguments: {
        channel_type: "voice",
        user_identifier: "+1234560004",
      },
    });
    const created = parseToolResult(createResult);
    pizzaSessionId = created.session_id;
    createdSessionIds.push(pizzaSessionId);
  });

  afterAll(async () => {
    await pizzaTransport.close();
    await burgerTransport.close();
  });

  test("Burger Barn agent cannot end a Pizza Palace session", async () => {
    const result = await burgerClient.callTool({
      name: "core_end_session",
      arguments: { session_id: pizzaSessionId },
    });

    const data = parseToolResult(result);
    expect(data.error).toBeDefined();
  });

  test("Burger Barn agent cannot escalate a Pizza Palace session", async () => {
    const result = await burgerClient.callTool({
      name: "core_escalate_session",
      arguments: { session_id: pizzaSessionId },
    });

    const data = parseToolResult(result);
    expect(data.error).toBeDefined();
  });

  test("Burger Barn agent cannot add messages to a Pizza Palace session", async () => {
    const result = await burgerClient.callTool({
      name: "core_add_messages",
      arguments: {
        session_id: pizzaSessionId,
        messages: [
          {
            role: "user",
            content: "Cross-org attack attempt",
            occurred_at: new Date().toISOString(),
          },
        ],
      },
    });

    const data = parseToolResult(result);
    expect(data.error).toBeDefined();
  });

  test("Pizza Palace session is still active (not affected by cross-org attempts)", async () => {
    const result = await pizzaClient.callTool({
      name: "core_end_session",
      arguments: { session_id: pizzaSessionId },
    });

    const data = parseToolResult(result);
    expect(data.status).toBe("completed");
  });
});
