/**
 * Integration tests for the core_classify_sop MCP tool.
 * Tests SOP classification flow: valid slug + high confidence, and unknown (null slug).
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import app from "@/app";
import { forApp } from "@db/rls";
import { agentSops, agents, sessions, sops } from "@db/schema";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { and, eq } from "drizzle-orm";
import { type TestSeed, agentHeadersFor, getTestSeed } from "../helpers/seed";

let s: TestSeed;
let orgAAgentHeaders: Record<string, string>;
let sopId: string;

/** IDs of sessions created during tests (for cleanup) */
const createdSessionIds: string[] = [];

function request(path: string, options?: RequestInit) {
  return app.fetch(new Request(`http://localhost${path}`, options));
}

/** Creates a session via the REST API and returns its ID */
async function createSessionViaRest(
  agentHeaders: Record<string, string>,
  channelType = "voice",
  userIdentifier = "+1234560100",
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
 */
async function createMcpClient(
  agentHeaders: Record<string, string>,
  agentId: string,
) {
  const transport = new StreamableHTTPClientTransport(
    new URL(`http://localhost/mcp/${agentId}`),
    {
      fetch: (url, init) => Promise.resolve(app.fetch(new Request(url, init))),
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
    const textContent = (
      result.content as Array<{ type: string; text?: string }>
    ).find((c) => c.type === "text");
    if (textContent && "text" in textContent) {
      return JSON.parse(textContent.text!);
    }
  }
  return {};
}

beforeAll(async () => {
  s = await getTestSeed();

  // Enable core tools for the orgA agent
  await forApp(async (tx) => {
    await tx
      .update(agents)
      .set({ metadata: { enableCoreAddMessages: true } })
      .where(eq(agents.id, s.orgAAgentId));
  });

  // Ensure there's an active SOP assigned to the agent
  // Look for an existing SOP first
  const existingSop = await forApp(async (tx) => {
    const [row] = await tx
      .select()
      .from(sops)
      .where(
        and(eq(sops.organizationId, s.orgA.id), eq(sops.status, "active")),
      );
    return row;
  });

  if (existingSop) {
    sopId = existingSop.id;
  } else {
    // Create an active SOP if none exists
    const [created] = await forApp(async (tx) => {
      return tx
        .insert(sops)
        .values({
          organizationId: s.orgA.id,
          name: "Where Is My Order",
          slug: "wismo",
          description: "Customer asking about order status, tracking, delivery",
          status: "active",
          trigger: { type: "manual", config: {} },
          metadata: {},
        })
        .returning();
    });
    sopId = created.id;
  }

  // Ensure SOP is assigned to the agent
  await forApp(async (tx) => {
    await tx
      .insert(agentSops)
      .values({ agentId: s.orgAAgentId, sopId })
      .onConflictDoNothing();
  });

  orgAAgentHeaders = await agentHeadersFor(s.orgAAgentId, s.orgA.id);
});

afterAll(async () => {
  await forApp(async (tx) => {
    for (const id of createdSessionIds) {
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
// core_classify_sop
// ============================================================================

describe("core_classify_sop", () => {
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

  test("AC 27: classifies with valid SOP slug and high confidence", async () => {
    const sessionId = await createSessionViaRest(
      orgAAgentHeaders,
      "voice",
      "+1234560101",
    );

    // Get the SOP slug from the database
    const sop = await forApp(async (tx) => {
      const [row] = await tx
        .select({ slug: sops.slug })
        .from(sops)
        .where(eq(sops.id, sopId));
      return row;
    });

    const result = await client.callTool({
      name: "core_classify_sop",
      arguments: {
        session_id: sessionId,
        sop_slug: sop.slug,
        confidence: 0.95,
      },
    });

    const data = parseToolResult(result);
    expect(data.error).toBeUndefined();
    expect(data.session_id).toBe(sessionId);

    const classification = data.sop_classification as Record<string, unknown>;
    expect(classification.sop_slug).toBe(sop.slug);
    expect(classification.confidence).toBe(0.95);
    expect(classification.unknown).toBe(false);

    // Verify metadata persisted via REST API
    const adminHeaders = await import("../helpers/seed").then((m) =>
      m.authHeadersFor(s.orgAAdmin),
    );
    const response = await request(`/api/sessions/${sessionId}`, {
      headers: await adminHeaders,
    });
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.metadata.sop_classification.sop_slug).toBe(sop.slug);
    expect(body.metadata.sop_classification.confidence).toBe(0.95);
    expect(body.metadata.sop_classification.unknown).toBe(false);
  });

  test("AC 28: classifies as unknown with null slug and zero confidence", async () => {
    const sessionId = await createSessionViaRest(
      orgAAgentHeaders,
      "web",
      "+1234560102",
    );

    const result = await client.callTool({
      name: "core_classify_sop",
      arguments: {
        session_id: sessionId,
        sop_slug: null,
        confidence: 0,
      },
    });

    const data = parseToolResult(result);
    expect(data.error).toBeUndefined();
    expect(data.session_id).toBe(sessionId);

    const classification = data.sop_classification as Record<string, unknown>;
    expect(classification.sop_slug).toBeNull();
    expect(classification.confidence).toBe(0);
    expect(classification.unknown).toBe(true);

    // Verify metadata persisted via REST API
    const adminHeaders = await import("../helpers/seed").then((m) =>
      m.authHeadersFor(s.orgAAdmin),
    );
    const response = await request(`/api/sessions/${sessionId}`, {
      headers: await adminHeaders,
    });
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.metadata.sop_classification.sop_slug).toBeNull();
    expect(body.metadata.sop_classification.confidence).toBe(0);
    expect(body.metadata.sop_classification.unknown).toBe(true);
  });

  test("rejects invalid SOP slug not assigned to agent", async () => {
    const sessionId = await createSessionViaRest(
      orgAAgentHeaders,
      "voice",
      "+1234560103",
    );

    const result = await client.callTool({
      name: "core_classify_sop",
      arguments: {
        session_id: sessionId,
        sop_slug: "nonexistent-sop",
        confidence: 0.5,
      },
    });

    const data = parseToolResult(result);
    expect(data.error).toBeDefined();
    expect(data.error as string).toContain("nonexistent-sop");
    expect(data.error as string).toContain("not assigned");
  });
});
