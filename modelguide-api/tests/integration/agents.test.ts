/**
 * Integration tests for Agents API
 * Tests the full HTTP request/response cycle with RLS isolation
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import app from "@/app";
import { forApp } from "@db/rls";
import { agentConnectorTools, agents } from "@db/schema";
import { eq, inArray } from "drizzle-orm";
import {
  type TestSeed,
  agentHeadersFor,
  authHeadersFor,
  getTestSeed,
} from "../helpers/seed";

let s: TestSeed;
let orgAAdminHeaders: Record<string, string>;
let orgASupportHeaders: Record<string, string>;
let orgBAdminHeaders: Record<string, string>;

/** IDs of agents created during tests (for cleanup) */
const createdAgentIds: string[] = [];

function request(path: string, options?: RequestInit) {
  return app.fetch(new Request(`http://localhost${path}`, options));
}

beforeAll(async () => {
  s = await getTestSeed();
  orgAAdminHeaders = await authHeadersFor(s.orgAAdmin);
  orgASupportHeaders = await authHeadersFor(s.orgASupport);
  orgBAdminHeaders = await authHeadersFor(s.orgBAdmin);
});

afterAll(async () => {
  if (createdAgentIds.length > 0) {
    await forApp(async (tx) => {
      await tx
        .delete(agentConnectorTools)
        .where(inArray(agentConnectorTools.agentId, createdAgentIds));
      for (const id of createdAgentIds) {
        await tx.delete(agents).where(eq(agents.id, id));
      }
    });
  }
});

// ============================================================================
// GET /api/agents - List agents
// ============================================================================

describe("GET /api/agents", () => {
  test("returns seeded agents with pagination (200)", async () => {
    const response = await request("/api/agents", {
      headers: orgAAdminHeaders,
    });

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.data).toBeArray();
    expect(body.data.length).toBeGreaterThanOrEqual(1);
    expect(body.pagination).toBeDefined();
    expect(body.pagination.page).toBe(1);

    const agent = body.data[0];
    expect(agent.id).toBeDefined();
    expect(agent.name).toBeDefined();
    expect(agent.modality).toBeDefined();
    expect(agent.isActive).toBeDefined();
    expect(agent.createdAt).toBeDefined();
  });

  test("filters by isActive=true (200)", async () => {
    const response = await request("/api/agents?isActive=true", {
      headers: orgAAdminHeaders,
    });

    expect(response.status).toBe(200);
    const body = await response.json();

    for (const agent of body.data) {
      expect(agent.isActive).toBe(true);
    }
  });

  test("filters by modality=voice (200)", async () => {
    const response = await request("/api/agents?modality=voice", {
      headers: orgAAdminHeaders,
    });

    expect(response.status).toBe(200);
    const body = await response.json();

    for (const agent of body.data) {
      expect(agent.modality).toBe("voice");
    }
  });

  test("accessible by support role (200)", async () => {
    const response = await request("/api/agents", {
      headers: orgASupportHeaders,
    });

    expect(response.status).toBe(200);
  });

  test("rejects unauthenticated request (401)", async () => {
    const response = await request("/api/agents");

    expect(response.status).toBe(401);
  });
});

// ============================================================================
// POST /api/agents - Create agent
// ============================================================================

describe("POST /api/agents", () => {
  test("creates agent + returns API key (201)", async () => {
    const response = await request("/api/agents", {
      method: "POST",
      headers: orgAAdminHeaders,
      body: JSON.stringify({
        name: "Test Agent Create",
        description: "Test agent for creation",
        modality: "voice",
      }),
    });

    expect(response.status).toBe(201);
    const body = await response.json();

    expect(body.id).toBeDefined();
    expect(body.name).toBe("Test Agent Create");
    expect(body.description).toBe("Test agent for creation");
    expect(body.modality).toBe("voice");
    expect(body.apiKey).toBeDefined();
    expect(body.createdAt).toBeDefined();

    createdAgentIds.push(body.id);
  });

  test("creates agent inactive by default", async () => {
    const response = await request("/api/agents", {
      method: "POST",
      headers: orgAAdminHeaders,
      body: JSON.stringify({
        name: "Test Agent Inactive Default",
      }),
    });

    expect(response.status).toBe(201);
    const body = await response.json();

    expect(body.isActive).toBe(false);
    createdAgentIds.push(body.id);
  });

  test("API key starts with mgk_", async () => {
    const response = await request("/api/agents", {
      method: "POST",
      headers: orgAAdminHeaders,
      body: JSON.stringify({
        name: "Test Agent Key Format",
      }),
    });

    expect(response.status).toBe(201);
    const body = await response.json();

    expect(body.apiKey).toStartWith("mgk_");
    createdAgentIds.push(body.id);
  });

  test("rejects support role (403)", async () => {
    const response = await request("/api/agents", {
      method: "POST",
      headers: orgASupportHeaders,
      body: JSON.stringify({
        name: "Support Attempt",
      }),
    });

    expect(response.status).toBe(403);
  });

  test("rejects missing name (422)", async () => {
    const response = await request("/api/agents", {
      method: "POST",
      headers: orgAAdminHeaders,
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(422);
  });
});

// ============================================================================
// GET /api/agents/:id - Get agent
// ============================================================================

describe("GET /api/agents/:id", () => {
  test("returns agent detail (200)", async () => {
    const response = await request(`/api/agents/${s.orgAAgentId}`, {
      headers: orgAAdminHeaders,
    });

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.id).toBe(s.orgAAgentId);
    expect(body.name).toBeDefined();
    expect(body.modality).toBeDefined();
    expect(body.systemPrompt).toBeUndefined();
  });

  test("returns 404 for non-existent agent", async () => {
    const fakeId = "00000000-0000-0000-0000-000000000000";
    const response = await request(`/api/agents/${fakeId}`, {
      headers: orgAAdminHeaders,
    });

    expect(response.status).toBe(404);
  });

  test("roundtrips multi-SOP compiledFrom shape through the API", async () => {
    // Regression guard: the API response schema for compiledFrom must match the
    // multi-SOP shape that compiler.service persists. If the schema drifts back
    // to the single-SOP shape, safeParse falls through to null and the UI loses
    // the compile-summary panel for every compiled agent.
    const createResp = await request("/api/agents", {
      method: "POST",
      headers: orgAAdminHeaders,
      body: JSON.stringify({ name: "CompiledFrom Roundtrip Agent" }),
    });
    expect(createResp.status).toBe(201);
    const { id: agentId } = await createResp.json();
    createdAgentIds.push(agentId);

    const sopId = "11111111-1111-1111-1111-111111111111";
    const compiledFrom = {
      sops: [{ sopId, sopName: "Test SOP", stepCount: 3 }],
      guardrailIds: [],
      toolCount: 2,
    };
    await forApp((tx) =>
      tx
        .update(agents)
        .set({
          compiledInstructions: "stub prompt",
          compiledAt: new Date(),
          compiledFrom,
        })
        .where(eq(agents.id, agentId)),
    );

    const response = await request(`/api/agents/${agentId}`, {
      headers: orgAAdminHeaders,
    });
    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.compiledFrom).not.toBeNull();
    expect(body.compiledFrom.sops).toEqual([
      { sopId, sopName: "Test SOP", stepCount: 3 },
    ]);
    expect(body.compiledFrom.toolCount).toBe(2);
    expect(body.compiledFrom.guardrailIds).toEqual([]);
  });
});

// ============================================================================
// GET /api/agents/me - Self-profile (agent API key auth)
// ============================================================================

describe("GET /api/agents/me", () => {
  test("returns the authenticated agent's compiled prompt + config (200)", async () => {
    // Seed the agent with a known compiled prompt so we can assert the worker
    // can pull it via its own API key — this is the canonical "live prompt"
    // path that the LiveKit POC worker uses on every job dispatch.
    const compiledAt = new Date();
    const compiledFrom = {
      sops: [
        {
          sopId: "22222222-2222-2222-2222-222222222222",
          sopName: "Me-Endpoint Test SOP",
          stepCount: 2,
        },
      ],
      guardrailIds: [],
      toolCount: 0,
    };
    await forApp((tx) =>
      tx
        .update(agents)
        .set({
          compiledInstructions: "You are the test agent. Be brief.",
          compiledAt,
          compiledFrom,
          promptConfig: { persona: "Friendly", language: "en" },
        })
        .where(eq(agents.id, s.orgAAgentId)),
    );

    const agentHeaders = await agentHeadersFor(s.orgAAgentId, s.orgA.id);
    const response = await request("/api/agents/me", { headers: agentHeaders });

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.id).toBe(s.orgAAgentId);
    expect(body.name).toBeDefined();
    expect(body.slug).toBeDefined();
    expect(body.compiledInstructions).toBe("You are the test agent. Be brief.");
    expect(body.compiledAt).toBeDefined();
    expect(body.compiledFrom).toEqual(compiledFrom);
    expect(body.promptConfig).toEqual({ persona: "Friendly", language: "en" });
    expect(body.modality).toBeDefined();
    expect(body.modelFamily).toBeDefined();
    // No secrets or raw API keys must leak through.
    expect(body.apiKey).toBeUndefined();
    expect(body.secrets).toBeUndefined();
  });

  test("returns null compiledInstructions when none has been compiled (200)", async () => {
    // Fresh agent without a compiled prompt — the worker must see explicit
    // `null` so it can decide to fall back to a stub system prompt.
    const createResp = await request("/api/agents", {
      method: "POST",
      headers: orgAAdminHeaders,
      body: JSON.stringify({
        name: "Me Endpoint Uncompiled Agent",
        modality: "voice",
      }),
    });
    expect(createResp.status).toBe(201);
    const { id: newAgentId, apiKey } = await createResp.json();
    createdAgentIds.push(newAgentId);

    // The freshly created agent is inactive by default — activate it so the
    // /me endpoint accepts the API key (requireAgent rejects inactive ones).
    const activate = await request(`/api/agents/${newAgentId}/activate`, {
      method: "POST",
      headers: orgAAdminHeaders,
    });
    expect(activate.status).toBe(200);

    const response = await request("/api/agents/me", {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.id).toBe(newAgentId);
    expect(body.compiledInstructions).toBeNull();
    expect(body.compiledAt).toBeNull();
  });

  test("rejects user JWT auth (401)", async () => {
    // Only API key (agent) auth is allowed — a logged-in dashboard user must
    // not be able to "impersonate" any agent through this endpoint.
    const response = await request("/api/agents/me", {
      headers: orgAAdminHeaders,
    });
    expect(response.status).toBe(401);
  });

  test("rejects unauthenticated request (401)", async () => {
    const response = await request("/api/agents/me");
    expect(response.status).toBe(401);
  });
});

// ============================================================================
// PATCH /api/agents/:id - Update agent
// ============================================================================

describe("PATCH /api/agents/:id", () => {
  let updateAgentId: string;

  beforeAll(async () => {
    const response = await request("/api/agents", {
      method: "POST",
      headers: orgAAdminHeaders,
      body: JSON.stringify({ name: "Update Target Agent" }),
    });
    const body = await response.json();
    updateAgentId = body.id;
    createdAgentIds.push(updateAgentId);
  });

  test("updates name and description (200)", async () => {
    const response = await request(`/api/agents/${updateAgentId}`, {
      method: "PATCH",
      headers: orgAAdminHeaders,
      body: JSON.stringify({
        name: "Updated Agent Name",
        description: "Updated description",
      }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.name).toBe("Updated Agent Name");
    expect(body.description).toBe("Updated description");
  });

  test("rejects support role (403)", async () => {
    const response = await request(`/api/agents/${updateAgentId}`, {
      method: "PATCH",
      headers: orgASupportHeaders,
      body: JSON.stringify({ name: "Hijacked" }),
    });

    expect(response.status).toBe(403);
  });

  test("rejects empty body (422)", async () => {
    const response = await request(`/api/agents/${updateAgentId}`, {
      method: "PATCH",
      headers: orgAAdminHeaders,
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(422);
  });

  test("returns 404 for non-existent agent", async () => {
    const fakeId = "00000000-0000-0000-0000-000000000000";
    const response = await request(`/api/agents/${fakeId}`, {
      method: "PATCH",
      headers: orgAAdminHeaders,
      body: JSON.stringify({ name: "Ghost" }),
    });

    expect(response.status).toBe(404);
  });
});

// ============================================================================
// DELETE /api/agents/:id - Delete agent
// ============================================================================

describe("DELETE /api/agents/:id", () => {
  test("deletes agent (204)", async () => {
    const createResponse = await request("/api/agents", {
      method: "POST",
      headers: orgAAdminHeaders,
      body: JSON.stringify({ name: "Delete Target Agent" }),
    });
    const { id } = await createResponse.json();

    const response = await request(`/api/agents/${id}`, {
      method: "DELETE",
      headers: orgAAdminHeaders,
    });

    expect(response.status).toBe(204);

    const getResponse = await request(`/api/agents/${id}`, {
      headers: orgAAdminHeaders,
    });
    expect(getResponse.status).toBe(404);
  });

  test("returns 404 for non-existent agent", async () => {
    const fakeId = "00000000-0000-0000-0000-000000000000";
    const response = await request(`/api/agents/${fakeId}`, {
      method: "DELETE",
      headers: orgAAdminHeaders,
    });

    expect(response.status).toBe(404);
  });

  test("rejects support role (403)", async () => {
    const response = await request(`/api/agents/${s.orgAAgentId}`, {
      method: "DELETE",
      headers: orgASupportHeaders,
    });

    expect(response.status).toBe(403);
  });
});

// ============================================================================
// POST /api/agents/:id/activate - Activate agent
// ============================================================================

describe("POST /api/agents/:id/activate", () => {
  let activateAgentId: string;

  beforeAll(async () => {
    const response = await request("/api/agents", {
      method: "POST",
      headers: orgAAdminHeaders,
      body: JSON.stringify({ name: "Activation Test Agent" }),
    });
    const body = await response.json();
    activateAgentId = body.id;
    createdAgentIds.push(activateAgentId);
  });

  test("sets isActive=true (200)", async () => {
    const response = await request(`/api/agents/${activateAgentId}/activate`, {
      method: "POST",
      headers: orgAAdminHeaders,
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.isActive).toBe(true);
  });

  test("rejects support role (403)", async () => {
    const response = await request(`/api/agents/${activateAgentId}/activate`, {
      method: "POST",
      headers: orgASupportHeaders,
    });

    expect(response.status).toBe(403);
  });

  test("returns 404 for non-existent agent", async () => {
    const fakeId = "00000000-0000-0000-0000-000000000000";
    const response = await request(`/api/agents/${fakeId}/activate`, {
      method: "POST",
      headers: orgAAdminHeaders,
    });

    expect(response.status).toBe(404);
  });
});

// ============================================================================
// POST /api/agents/:id/deactivate - Deactivate agent
// ============================================================================

describe("POST /api/agents/:id/deactivate", () => {
  let deactivateAgentId: string;

  beforeAll(async () => {
    const response = await request("/api/agents", {
      method: "POST",
      headers: orgAAdminHeaders,
      body: JSON.stringify({ name: "Deactivation Test Agent" }),
    });
    const body = await response.json();
    deactivateAgentId = body.id;
    createdAgentIds.push(deactivateAgentId);

    // Activate first
    await request(`/api/agents/${deactivateAgentId}/activate`, {
      method: "POST",
      headers: orgAAdminHeaders,
    });
  });

  test("sets isActive=false (200)", async () => {
    const response = await request(
      `/api/agents/${deactivateAgentId}/deactivate`,
      {
        method: "POST",
        headers: orgAAdminHeaders,
      },
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.isActive).toBe(false);
  });

  test("rejects support role (403)", async () => {
    const response = await request(
      `/api/agents/${deactivateAgentId}/deactivate`,
      {
        method: "POST",
        headers: orgASupportHeaders,
      },
    );

    expect(response.status).toBe(403);
  });

  test("returns 404 for non-existent agent", async () => {
    const fakeId = "00000000-0000-0000-0000-000000000000";
    const response = await request(`/api/agents/${fakeId}/deactivate`, {
      method: "POST",
      headers: orgAAdminHeaders,
    });

    expect(response.status).toBe(404);
  });
});

// ============================================================================
// POST /api/agents/:id/regenerate-key - Regenerate API key
// ============================================================================

describe("POST /api/agents/:id/regenerate-key", () => {
  let regenAgentId: string;
  let originalKey: string;

  beforeAll(async () => {
    const response = await request("/api/agents", {
      method: "POST",
      headers: orgAAdminHeaders,
      body: JSON.stringify({ name: "Regen Key Test Agent" }),
    });
    const body = await response.json();
    regenAgentId = body.id;
    originalKey = body.apiKey;
    createdAgentIds.push(regenAgentId);
  });

  test("returns new API key (200)", async () => {
    const response = await request(
      `/api/agents/${regenAgentId}/regenerate-key`,
      {
        method: "POST",
        headers: orgAAdminHeaders,
      },
    );

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.apiKey).toBeDefined();
    expect(body.apiKey).toStartWith("mgk_");
    expect(body.keyPrefix).toBeDefined();
    expect(body.keyPrefix).toStartWith("mgk_");
  });

  test("new key is different from original", async () => {
    const response = await request(
      `/api/agents/${regenAgentId}/regenerate-key`,
      {
        method: "POST",
        headers: orgAAdminHeaders,
      },
    );

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.apiKey).not.toBe(originalKey);
  });

  test("rejects support role (403)", async () => {
    const response = await request(
      `/api/agents/${regenAgentId}/regenerate-key`,
      {
        method: "POST",
        headers: orgASupportHeaders,
      },
    );

    expect(response.status).toBe(403);
  });

  test("returns 404 for non-existent agent", async () => {
    const fakeId = "00000000-0000-0000-0000-000000000000";
    const response = await request(`/api/agents/${fakeId}/regenerate-key`, {
      method: "POST",
      headers: orgAAdminHeaders,
    });

    expect(response.status).toBe(404);
  });
});

// ============================================================================
// Agent Connector Assignment
// ============================================================================

describe("Agent Connector Tools", () => {
  let connectorAgentId: string;
  let toolSlugs: string[];

  beforeAll(async () => {
    const response = await request("/api/agents", {
      method: "POST",
      headers: orgAAdminHeaders,
      body: JSON.stringify({ name: "Connector Test Agent" }),
    });
    const body = await response.json();
    connectorAgentId = body.id;
    createdAgentIds.push(connectorAgentId);

    const toolsResponse = await request(
      `/api/connectors/${s.orgAMedusaConnectorId}/tools`,
      { headers: orgAAdminHeaders },
    );
    const toolsBody = await toolsResponse.json();
    toolSlugs = toolsBody.data.map((t: { slug: string }) => t.slug);
  });

  test("POST /:id/connectors assigns connector with tools (201)", async () => {
    const response = await request(
      `/api/agents/${connectorAgentId}/connectors`,
      {
        method: "POST",
        headers: orgAAdminHeaders,
        body: JSON.stringify({
          connectorId: s.orgAMedusaConnectorId,
          tools: [
            {
              slug: toolSlugs[0],
              isEnabled: true,
              requiresConfirmation: false,
            },
            {
              slug: toolSlugs[1],
              isEnabled: true,
              requiresConfirmation: true,
            },
          ],
        }),
      },
    );

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.assigned).toBe(2);
  });

  test("GET /:id/connectors lists assigned connectors + tools (200)", async () => {
    const response = await request(
      `/api/agents/${connectorAgentId}/connectors`,
      { headers: orgAAdminHeaders },
    );

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.data).toBeArray();
    expect(body.data.length).toBeGreaterThanOrEqual(1);

    const connector = body.data[0];
    expect(connector.connectorId).toBe(s.orgAMedusaConnectorId);
    expect(connector.connectorSlug).toBeDefined();
    expect(connector.connectorName).toBeDefined();
    expect(connector.tools).toBeArray();
    expect(connector.tools.length).toBe(2);
  });

  test("PATCH /:id/connectors/:connectorId updates tool settings (200)", async () => {
    const response = await request(
      `/api/agents/${connectorAgentId}/connectors/${s.orgAMedusaConnectorId}`,
      {
        method: "PATCH",
        headers: orgAAdminHeaders,
        body: JSON.stringify({
          tools: [
            {
              slug: toolSlugs[0],
              isEnabled: false,
              requiresConfirmation: true,
            },
          ],
        }),
      },
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.updated).toBeGreaterThanOrEqual(1);
  });

  test("rejects duplicate connector-tool assignment (409)", async () => {
    const response = await request(
      `/api/agents/${connectorAgentId}/connectors`,
      {
        method: "POST",
        headers: orgAAdminHeaders,
        body: JSON.stringify({
          connectorId: s.orgAMedusaConnectorId,
          tools: [{ slug: toolSlugs[0], isEnabled: true }],
        }),
      },
    );

    expect(response.status).toBe(409);
  });

  test("rejects non-existent connector (404)", async () => {
    const fakeId = "00000000-0000-0000-0000-000000000000";
    const response = await request(
      `/api/agents/${connectorAgentId}/connectors`,
      {
        method: "POST",
        headers: orgAAdminHeaders,
        body: JSON.stringify({
          connectorId: fakeId,
          tools: [{ slug: "add_to_cart" }],
        }),
      },
    );

    expect(response.status).toBe(404);
  });

  test("rejects support role for assignment (403)", async () => {
    const response = await request(
      `/api/agents/${connectorAgentId}/connectors`,
      {
        method: "POST",
        headers: orgASupportHeaders,
        body: JSON.stringify({
          connectorId: s.orgAMedusaConnectorId,
          tools: [{ slug: toolSlugs[2] }],
        }),
      },
    );

    expect(response.status).toBe(403);
  });

  test("DELETE /:id/connectors/:connectorId removes assignment (204)", async () => {
    const response = await request(
      `/api/agents/${connectorAgentId}/connectors/${s.orgAMedusaConnectorId}`,
      {
        method: "DELETE",
        headers: orgAAdminHeaders,
      },
    );

    expect(response.status).toBe(204);

    const listResponse = await request(
      `/api/agents/${connectorAgentId}/connectors`,
      { headers: orgAAdminHeaders },
    );
    const body = await listResponse.json();
    const orgAConnector = body.data.find(
      (c: { connectorId: string }) => c.connectorId === s.orgAMedusaConnectorId,
    );
    expect(orgAConnector).toBeUndefined();
  });
});

// ============================================================================
// GET /api/agents/:id/connectors - Seeded agent connectors
// ============================================================================

describe("GET /api/agents/:id/connectors (seeded)", () => {
  test("returns seeded agent connectors grouped by connector (200)", async () => {
    const response = await request(`/api/agents/${s.orgAAgentId}/connectors`, {
      headers: orgAAdminHeaders,
    });

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.data).toBeArray();
    expect(body.data.length).toBeGreaterThanOrEqual(1);

    // Seeded agent has all 10 Medusa tools linked (8 storefront + 2 admin)
    const connector = body.data[0];
    expect(connector.tools.length).toBe(10);
  });

  test("accessible by support role (200)", async () => {
    const response = await request(`/api/agents/${s.orgAAgentId}/connectors`, {
      headers: orgASupportHeaders,
    });

    expect(response.status).toBe(200);
  });
});

// ============================================================================
// RLS isolation
// ============================================================================

describe("RLS isolation", () => {
  test("org B cannot see org A agents in list", async () => {
    const response = await request("/api/agents", {
      headers: orgBAdminHeaders,
    });

    expect(response.status).toBe(200);
    const body = await response.json();

    const ids = body.data.map((a: { id: string }) => a.id);
    expect(ids).not.toContain(s.orgAAgentId);
  });

  test("org B cannot get org A agent by ID (404)", async () => {
    const response = await request(`/api/agents/${s.orgAAgentId}`, {
      headers: orgBAdminHeaders,
    });

    expect(response.status).toBe(404);
  });

  test("org B cannot update org A agent (404)", async () => {
    const response = await request(`/api/agents/${s.orgAAgentId}`, {
      method: "PATCH",
      headers: orgBAdminHeaders,
      body: JSON.stringify({ name: "Hijacked" }),
    });

    expect(response.status).toBe(404);
  });

  test("org B cannot delete org A agent (404)", async () => {
    const response = await request(`/api/agents/${s.orgAAgentId}`, {
      method: "DELETE",
      headers: orgBAdminHeaders,
    });

    expect(response.status).toBe(404);
  });

  test("org B cannot assign connectors to org A agent (404)", async () => {
    const response = await request(`/api/agents/${s.orgAAgentId}/connectors`, {
      method: "POST",
      headers: orgBAdminHeaders,
      body: JSON.stringify({
        connectorId: s.orgAMedusaConnectorId,
        tools: [{ slug: "add_to_cart" }],
      }),
    });

    expect(response.status).toBe(404);
  });

  test("org B cannot see org A agent connectors (404)", async () => {
    const response = await request(`/api/agents/${s.orgAAgentId}/connectors`, {
      headers: orgBAdminHeaders,
    });

    expect(response.status).toBe(404);
  });

  test("cannot assign cross-org connector to own agent (404)", async () => {
    // org A admin tries to assign org B's connector
    const response = await request(`/api/agents/${s.orgAAgentId}/connectors`, {
      method: "POST",
      headers: orgAAdminHeaders,
      body: JSON.stringify({
        connectorId: s.orgBMedusaConnectorId,
        tools: [{ slug: "add_to_cart" }],
      }),
    });

    expect(response.status).toBe(404);
  });
});

// ============================================================================
// CRUD audit — strict validation (#64)
// ============================================================================

describe("Strict PATCH schema", () => {
  test("rejects unknown fields with 422", async () => {
    const response = await request(`/api/agents/${s.orgAAgentId}`, {
      method: "PATCH",
      headers: orgAAdminHeaders,
      body: JSON.stringify({ name: "Valid Name", bogusField: "nope" }),
    });

    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.error?.formErrors || body.error?.fieldErrors).toBeDefined();
  });
});

// ============================================================================
// POST /api/agents/:id/voice-test-token — WebRTC voice-test POC
// ============================================================================

describe("POST /api/agents/:id/voice-test-token", () => {
  test("returns 400 when LiveKit is not configured", async () => {
    // Seeded orgA voice agent has no LiveKit config by default.
    const response = await request(
      `/api/agents/${s.orgAAgentId}/voice-test-token`,
      {
        method: "POST",
        headers: orgAAdminHeaders,
      },
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(JSON.stringify(body)).toMatch(/LiveKit/i);
  });

  test("rejects unauthenticated request (401)", async () => {
    const response = await request(
      `/api/agents/${s.orgAAgentId}/voice-test-token`,
      { method: "POST" },
    );

    expect(response.status).toBe(401);
  });

  test("org B cannot voice-test an org A agent (404)", async () => {
    const response = await request(
      `/api/agents/${s.orgAAgentId}/voice-test-token`,
      {
        method: "POST",
        headers: orgBAdminHeaders,
      },
    );

    expect(response.status).toBe(404);
  });

  test("returns 404 for unknown agent", async () => {
    const response = await request(
      "/api/agents/00000000-0000-0000-0000-000000000000/voice-test-token",
      {
        method: "POST",
        headers: orgAAdminHeaders,
      },
    );

    expect(response.status).toBe(404);
  });

  test("rejects inactive agents (400)", async () => {
    // Create an inactive voice agent so we can hit the isActive guard.
    const createResp = await request("/api/agents", {
      method: "POST",
      headers: orgAAdminHeaders,
      body: JSON.stringify({ name: "Inactive Voice Test Agent" }),
    });
    expect(createResp.status).toBe(201);
    const { id: agentId } = await createResp.json();
    createdAgentIds.push(agentId);

    // The seed creates agents as isActive: false by default, which is exactly
    // what we want here — no activation step needed.
    const response = await request(`/api/agents/${agentId}/voice-test-token`, {
      method: "POST",
      headers: orgAAdminHeaders,
    });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(JSON.stringify(body)).toMatch(/not active/i);
  });

  test("rejects non-voice modality (400)", async () => {
    const createResp = await request("/api/agents", {
      method: "POST",
      headers: orgAAdminHeaders,
      body: JSON.stringify({
        name: "Text Modality Voice Test Agent",
        modality: "text",
      }),
    });
    expect(createResp.status).toBe(201);
    const { id: agentId } = await createResp.json();
    createdAgentIds.push(agentId);

    // Activate + configure LiveKit so the modality check is the one that trips.
    await forApp((tx) =>
      tx
        .update(agents)
        .set({
          isActive: true,
          agentPlatform: "livekit",
          metadata: {
            livekit: { url: "wss://test.livekit.cloud", agentName: "w" },
          },
        })
        .where(eq(agents.id, agentId)),
    );

    const response = await request(`/api/agents/${agentId}/voice-test-token`, {
      method: "POST",
      headers: orgAAdminHeaders,
    });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(JSON.stringify(body)).toMatch(/voice agent/i);
  });

  test("rejects non-livekit platform (400)", async () => {
    const createResp = await request("/api/agents", {
      method: "POST",
      headers: orgAAdminHeaders,
      body: JSON.stringify({ name: "Custom Platform Voice Test Agent" }),
    });
    expect(createResp.status).toBe(201);
    const { id: agentId } = await createResp.json();
    createdAgentIds.push(agentId);

    // Activate but keep agentPlatform as the default `custom`.
    await forApp((tx) =>
      tx.update(agents).set({ isActive: true }).where(eq(agents.id, agentId)),
    );

    const response = await request(`/api/agents/${agentId}/voice-test-token`, {
      method: "POST",
      headers: orgAAdminHeaders,
    });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(JSON.stringify(body)).toMatch(/LiveKit/i);
  });

  test("rejects support role (403) — agents:activate is admin-only", async () => {
    const response = await request(
      `/api/agents/${s.orgAAgentId}/voice-test-token`,
      {
        method: "POST",
        headers: orgASupportHeaders,
      },
    );

    expect(response.status).toBe(403);
  });
});

describe("Agent slug uniqueness", () => {
  test("creating agent with duplicate name (same slug) returns 409", async () => {
    const res1 = await request("/api/agents", {
      method: "POST",
      headers: orgAAdminHeaders,
      body: JSON.stringify({ name: "Slug Collision Agent" }),
    });
    expect(res1.status).toBe(201);
    const agent1 = await res1.json();
    createdAgentIds.push(agent1.id);

    const res2 = await request("/api/agents", {
      method: "POST",
      headers: orgAAdminHeaders,
      body: JSON.stringify({ name: "Slug Collision Agent" }),
    });

    expect(res2.status).toBe(409);
    const body = await res2.json();
    expect(body.code).toBe("ALREADY_EXISTS");
  });

  test("creating agent with explicit duplicate slug returns 409", async () => {
    const res1 = await request("/api/agents", {
      method: "POST",
      headers: orgAAdminHeaders,
      body: JSON.stringify({
        name: "Explicit Slug Agent",
        slug: "explicit-slug-test-64",
      }),
    });
    expect(res1.status).toBe(201);
    const agent1 = await res1.json();
    createdAgentIds.push(agent1.id);

    const res2 = await request("/api/agents", {
      method: "POST",
      headers: orgAAdminHeaders,
      body: JSON.stringify({
        name: "Different Name",
        slug: "explicit-slug-test-64",
      }),
    });

    expect(res2.status).toBe(409);
    const body = await res2.json();
    expect(body.code).toBe("ALREADY_EXISTS");
  });
});
