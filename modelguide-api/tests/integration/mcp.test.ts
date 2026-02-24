/**
 * Integration tests for the MCP endpoint (POST /mcp)
 * Tests the full MCP protocol flow using the SDK's own Client + StreamableHTTPClientTransport,
 * with Hono's app.fetch as the custom fetch function (no real HTTP server needed).
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import app from "@/app";
import { forApp } from "@db/rls";
import { agents, sessions } from "@db/schema";
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
let orgAAdminHeaders: Record<string, string>;
let orgAAgentHeaders: Record<string, string>;
let orgBAgentHeaders: Record<string, string>;

/** IDs of sessions created during tests (for cleanup) */
const createdSessionIds: string[] = [];

function request(path: string, options?: RequestInit) {
  return app.fetch(new Request(`http://localhost${path}`, options));
}

/** Creates a session via the REST API and returns its ID */
async function createSessionViaRest(
  agentHeaders: Record<string, string>,
  channelType = "voice",
  userIdentifier = "+1234560000",
): Promise<string> {
  const response = await request("/api/sessions", {
    method: "POST",
    headers: { ...agentHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({
      channelType,
      userIdentifier,
    }),
  });
  const body = await response.json();
  const id = body.id as string;
  createdSessionIds.push(id);
  return id;
}

/**
 * Creates a connected MCP Client backed by Hono's app.fetch.
 * The returned client handles initialize/initialized automatically via `connect()`.
 */
async function createMcpClient(
  agentHeaders: Record<string, string>,
  agentId: string,
) {
  const transport = new StreamableHTTPClientTransport(
    new URL(`http://localhost/mcp/${agentId}`),
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

  // Enable core_add_messages for the orgA agent (disabled by default)
  await forApp(async (tx) => {
    await tx
      .update(agents)
      .set({ metadata: { enableCoreAddMessages: true } })
      .where(eq(agents.id, s.orgAAgentId));
  });

  [orgAAdminHeaders, orgAAgentHeaders, orgBAgentHeaders] = await Promise.all([
    authHeadersFor(s.orgAAdmin),
    agentHeadersFor(s.orgAAgentId, s.orgA.id),
    agentHeadersFor(s.orgBAgentId, s.orgB.id),
  ]);
});

afterAll(async () => {
  await forApp(async (tx) => {
    for (const id of createdSessionIds) {
      // Messages and feedback are cascade-deleted by FK
      await tx.delete(sessions).where(eq(sessions.id, id));
    }
    // Restore agent metadata
    await tx
      .update(agents)
      .set({ metadata: {} })
      .where(eq(agents.id, s.orgAAgentId));
  });
});

// ============================================================================
// Auth & access control
// ============================================================================

describe("Auth & access control", () => {
  test("rejects request with no auth header", async () => {
    const response = await request(`/mcp/${s.orgAAgentId}`, {
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
    const response = await request(`/mcp/${s.orgAAgentId}`, {
      method: "POST",
      headers: {
        ...orgAAdminHeaders,
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
    const { client, transport } = await createMcpClient(
      orgAAgentHeaders,
      s.orgAAgentId,
    );

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
    ({ client, transport } = await createMcpClient(
      orgAAgentHeaders,
      s.orgAAgentId,
    ));
  });

  afterAll(async () => {
    await transport.close();
  });

  test("returns core tools and connector tools", async () => {
    const result = await client.listTools();

    expect(result.tools.length).toBeGreaterThanOrEqual(1);

    const coreToolNames = result.tools
      .filter((t) => t.name.startsWith("core_"))
      .map((t) => t.name);

    expect(coreToolNames).toContain("core_add_messages");
    expect(coreToolNames.length).toBe(1);
  });

  test("core_add_messages is hidden when enableCoreAddMessages is not set", async () => {
    // org B agent has default metadata (no enableCoreAddMessages)
    const { client: orgBClient, transport: orgBTransport } =
      await createMcpClient(orgBAgentHeaders, s.orgBAgentId);

    const result = await orgBClient.listTools();
    const coreToolNames = result.tools
      .filter((t) => t.name.startsWith("core_"))
      .map((t) => t.name);

    expect(coreToolNames.length).toBe(0);
    await orgBTransport.close();
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
    ({ client, transport } = await createMcpClient(
      orgAAgentHeaders,
      s.orgAAgentId,
    ));
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
    expect(data.agent_id).toBe(s.orgAAgentId);
    expect(data.organization_id).toBe(s.orgA.id);
    expect(typeof data.tool_count).toBe("number");
    expect(data.tool_count).toBeGreaterThanOrEqual(1);
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
// Core tool: core_add_messages
// ============================================================================

describe("core_add_messages", () => {
  let client: Client;
  let transport: StreamableHTTPClientTransport;
  let sessionId: string;

  beforeAll(async () => {
    ({ client, transport } = await createMcpClient(
      orgAAgentHeaders,
      s.orgAAgentId,
    ));
    sessionId = await createSessionViaRest(
      orgAAgentHeaders,
      "voice",
      "+1234560002",
    );
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
            content: "Hello, I'm looking for a skincare product",
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
      headers: orgAAdminHeaders,
    });

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.messages.length).toBeGreaterThanOrEqual(2);

    const userMsg = body.messages.find(
      (m: { role: string; content: string }) =>
        m.role === "user" &&
        m.content === "Hello, I'm looking for a skincare product",
    );
    expect(userMsg).toBeDefined();
  });
});

// ============================================================================
// RLS isolation
// ============================================================================

describe("RLS isolation", () => {
  let _orgAClient: Client;
  let orgATransport: StreamableHTTPClientTransport;
  let orgBClient: Client;
  let orgBTransport: StreamableHTTPClientTransport;
  let orgASessionId: string;

  beforeAll(async () => {
    // Enable core_add_messages for the orgB agent so the tool is registered
    // and the RLS test exercises cross-org rejection at the service layer
    await forApp(async (tx) => {
      await tx
        .update(agents)
        .set({ metadata: { enableCoreAddMessages: true } })
        .where(eq(agents.id, s.orgBAgentId));
    });

    ({ client: _orgAClient, transport: orgATransport } = await createMcpClient(
      orgAAgentHeaders,
      s.orgAAgentId,
    ));
    ({ client: orgBClient, transport: orgBTransport } = await createMcpClient(
      orgBAgentHeaders,
      s.orgBAgentId,
    ));

    orgASessionId = await createSessionViaRest(
      orgAAgentHeaders,
      "voice",
      "+1234560004",
    );
  });

  afterAll(async () => {
    await orgATransport.close();
    await orgBTransport.close();
    // Restore orgB agent metadata
    await forApp(async (tx) => {
      await tx
        .update(agents)
        .set({ metadata: {} })
        .where(eq(agents.id, s.orgBAgentId));
    });
  });

  test("org B agent cannot add messages to a org A session", async () => {
    const result = await orgBClient.callTool({
      name: "core_add_messages",
      arguments: {
        session_id: orgASessionId,
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
});
