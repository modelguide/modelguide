/**
 * Integration tests for Agents API
 * Tests the full HTTP request/response cycle with RLS isolation
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import app from "@/app";
import { forApp } from "@db/rls";
import { agentConnectorTools, agents } from "@db/schema";
import { eq, inArray } from "drizzle-orm";
import { type TestSeed, authHeadersFor, getTestSeed } from "../helpers/seed";

let s: TestSeed;
let pizzaAdminHeaders: Record<string, string>;
let pizzaSupportHeaders: Record<string, string>;
let burgerAdminHeaders: Record<string, string>;

/** IDs of agents created during tests (for cleanup) */
const createdAgentIds: string[] = [];

function request(path: string, options?: RequestInit) {
  return app.fetch(new Request(`http://localhost${path}`, options));
}

beforeAll(async () => {
  s = await getTestSeed();
  pizzaAdminHeaders = await authHeadersFor(s.pizzaAdmin);
  pizzaSupportHeaders = await authHeadersFor(s.pizzaSupport);
  burgerAdminHeaders = await authHeadersFor(s.burgerAdmin);
});

afterAll(async () => {
  if (createdAgentIds.length > 0) {
    await forApp(async (tx) => {
      // Clean up agent_connector_tools first (no cascade from agents for test-created ones)
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
      headers: pizzaAdminHeaders,
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
    expect(agent.agentType).toBeDefined();
    expect(agent.isActive).toBeDefined();
    expect(agent.createdAt).toBeDefined();
  });

  test("filters by isActive=true (200)", async () => {
    const response = await request("/api/agents?isActive=true", {
      headers: pizzaAdminHeaders,
    });

    expect(response.status).toBe(200);
    const body = await response.json();

    for (const agent of body.data) {
      expect(agent.isActive).toBe(true);
    }
  });

  test("filters by agentType=voice (200)", async () => {
    const response = await request("/api/agents?agentType=voice", {
      headers: pizzaAdminHeaders,
    });

    expect(response.status).toBe(200);
    const body = await response.json();

    for (const agent of body.data) {
      expect(agent.agentType).toBe("voice");
    }
  });

  test("accessible by support role (200)", async () => {
    const response = await request("/api/agents", {
      headers: pizzaSupportHeaders,
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
      headers: pizzaAdminHeaders,
      body: JSON.stringify({
        name: "Test Agent Create",
        description: "Test agent for creation",
        agentType: "voice",
        systemPrompt: "You are a test agent.",
        tags: ["test"],
        metadata: { version: "1.0" },
      }),
    });

    expect(response.status).toBe(201);
    const body = await response.json();

    expect(body.id).toBeDefined();
    expect(body.name).toBe("Test Agent Create");
    expect(body.description).toBe("Test agent for creation");
    expect(body.agentType).toBe("voice");
    expect(body.apiKey).toBeDefined();
    expect(body.createdAt).toBeDefined();

    createdAgentIds.push(body.id);
  });

  test("creates agent inactive by default", async () => {
    const response = await request("/api/agents", {
      method: "POST",
      headers: pizzaAdminHeaders,
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
      headers: pizzaAdminHeaders,
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
      headers: pizzaSupportHeaders,
      body: JSON.stringify({
        name: "Support Attempt",
      }),
    });

    expect(response.status).toBe(403);
  });

  test("rejects missing name (422)", async () => {
    const response = await request("/api/agents", {
      method: "POST",
      headers: pizzaAdminHeaders,
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
    const response = await request(`/api/agents/${s.pizzaAgentId}`, {
      headers: pizzaAdminHeaders,
    });

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.id).toBe(s.pizzaAgentId);
    expect(body.name).toBeDefined();
    expect(body.agentType).toBeDefined();
    expect(body.systemPrompt).toBeDefined();
  });

  test("returns 404 for non-existent agent", async () => {
    const fakeId = "00000000-0000-0000-0000-000000000000";
    const response = await request(`/api/agents/${fakeId}`, {
      headers: pizzaAdminHeaders,
    });

    expect(response.status).toBe(404);
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
      headers: pizzaAdminHeaders,
      body: JSON.stringify({ name: "Update Target Agent" }),
    });
    const body = await response.json();
    updateAgentId = body.id;
    createdAgentIds.push(updateAgentId);
  });

  test("updates name and description (200)", async () => {
    const response = await request(`/api/agents/${updateAgentId}`, {
      method: "PATCH",
      headers: pizzaAdminHeaders,
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
      headers: pizzaSupportHeaders,
      body: JSON.stringify({ name: "Hijacked" }),
    });

    expect(response.status).toBe(403);
  });

  test("rejects empty body (422)", async () => {
    const response = await request(`/api/agents/${updateAgentId}`, {
      method: "PATCH",
      headers: pizzaAdminHeaders,
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(422);
  });

  test("returns 404 for non-existent agent", async () => {
    const fakeId = "00000000-0000-0000-0000-000000000000";
    const response = await request(`/api/agents/${fakeId}`, {
      method: "PATCH",
      headers: pizzaAdminHeaders,
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
    // Create an agent to delete
    const createResponse = await request("/api/agents", {
      method: "POST",
      headers: pizzaAdminHeaders,
      body: JSON.stringify({ name: "Delete Target Agent" }),
    });
    const { id } = await createResponse.json();

    const response = await request(`/api/agents/${id}`, {
      method: "DELETE",
      headers: pizzaAdminHeaders,
    });

    expect(response.status).toBe(204);

    // Verify it's gone
    const getResponse = await request(`/api/agents/${id}`, {
      headers: pizzaAdminHeaders,
    });
    expect(getResponse.status).toBe(404);
  });

  test("returns 404 for non-existent agent", async () => {
    const fakeId = "00000000-0000-0000-0000-000000000000";
    const response = await request(`/api/agents/${fakeId}`, {
      method: "DELETE",
      headers: pizzaAdminHeaders,
    });

    expect(response.status).toBe(404);
  });

  test("rejects support role (403)", async () => {
    const response = await request(`/api/agents/${s.pizzaAgentId}`, {
      method: "DELETE",
      headers: pizzaSupportHeaders,
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
      headers: pizzaAdminHeaders,
      body: JSON.stringify({ name: "Activation Test Agent" }),
    });
    const body = await response.json();
    activateAgentId = body.id;
    createdAgentIds.push(activateAgentId);
  });

  test("sets isActive=true (200)", async () => {
    const response = await request(`/api/agents/${activateAgentId}/activate`, {
      method: "POST",
      headers: pizzaAdminHeaders,
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.isActive).toBe(true);
  });

  test("rejects support role (403)", async () => {
    const response = await request(`/api/agents/${activateAgentId}/activate`, {
      method: "POST",
      headers: pizzaSupportHeaders,
    });

    expect(response.status).toBe(403);
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
      headers: pizzaAdminHeaders,
      body: JSON.stringify({ name: "Deactivation Test Agent" }),
    });
    const body = await response.json();
    deactivateAgentId = body.id;
    createdAgentIds.push(deactivateAgentId);

    // Activate first
    await request(`/api/agents/${deactivateAgentId}/activate`, {
      method: "POST",
      headers: pizzaAdminHeaders,
    });
  });

  test("sets isActive=false (200)", async () => {
    const response = await request(
      `/api/agents/${deactivateAgentId}/deactivate`,
      {
        method: "POST",
        headers: pizzaAdminHeaders,
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
        headers: pizzaSupportHeaders,
      },
    );

    expect(response.status).toBe(403);
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
      headers: pizzaAdminHeaders,
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
        headers: pizzaAdminHeaders,
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
        headers: pizzaAdminHeaders,
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
        headers: pizzaSupportHeaders,
      },
    );

    expect(response.status).toBe(403);
  });

  test("returns 404 for non-existent agent", async () => {
    const fakeId = "00000000-0000-0000-0000-000000000000";
    const response = await request(`/api/agents/${fakeId}/regenerate-key`, {
      method: "POST",
      headers: pizzaAdminHeaders,
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
    // Create a fresh agent for connector tests
    const response = await request("/api/agents", {
      method: "POST",
      headers: pizzaAdminHeaders,
      body: JSON.stringify({ name: "Connector Test Agent" }),
    });
    const body = await response.json();
    connectorAgentId = body.id;
    createdAgentIds.push(connectorAgentId);

    // Get tool slugs from the pizza connector
    const toolsResponse = await request(
      `/api/connectors/${s.pizzaConnectorId}/tools`,
      { headers: pizzaAdminHeaders },
    );
    const toolsBody = await toolsResponse.json();
    toolSlugs = toolsBody.data.map((t: { slug: string }) => t.slug);
  });

  test("POST /:id/connectors assigns connector with tools (201)", async () => {
    const response = await request(
      `/api/agents/${connectorAgentId}/connectors`,
      {
        method: "POST",
        headers: pizzaAdminHeaders,
        body: JSON.stringify({
          connectorId: s.pizzaConnectorId,
          tools: [
            {
              name: toolSlugs[0],
              isEnabled: true,
              requiresConfirmation: false,
            },
            { name: toolSlugs[1], isEnabled: true, requiresConfirmation: true },
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
      { headers: pizzaAdminHeaders },
    );

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.data).toBeArray();
    expect(body.data.length).toBeGreaterThanOrEqual(1);

    const connector = body.data[0];
    expect(connector.connectorId).toBe(s.pizzaConnectorId);
    expect(connector.connectorSlug).toBeDefined();
    expect(connector.connectorName).toBeDefined();
    expect(connector.tools).toBeArray();
    expect(connector.tools.length).toBe(2);
  });

  test("PATCH /:id/connectors/:connectorId updates tool settings (200)", async () => {
    const response = await request(
      `/api/agents/${connectorAgentId}/connectors/${s.pizzaConnectorId}`,
      {
        method: "PATCH",
        headers: pizzaAdminHeaders,
        body: JSON.stringify({
          tools: [
            {
              name: toolSlugs[0],
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
        headers: pizzaAdminHeaders,
        body: JSON.stringify({
          connectorId: s.pizzaConnectorId,
          tools: [{ name: toolSlugs[0], isEnabled: true }],
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
        headers: pizzaAdminHeaders,
        body: JSON.stringify({
          connectorId: fakeId,
          tools: [{ name: "add_to_cart" }],
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
        headers: pizzaSupportHeaders,
        body: JSON.stringify({
          connectorId: s.pizzaConnectorId,
          tools: [{ name: toolSlugs[2] }],
        }),
      },
    );

    expect(response.status).toBe(403);
  });

  test("DELETE /:id/connectors/:connectorId removes assignment (204)", async () => {
    const response = await request(
      `/api/agents/${connectorAgentId}/connectors/${s.pizzaConnectorId}`,
      {
        method: "DELETE",
        headers: pizzaAdminHeaders,
      },
    );

    expect(response.status).toBe(204);

    // Verify tools removed
    const listResponse = await request(
      `/api/agents/${connectorAgentId}/connectors`,
      { headers: pizzaAdminHeaders },
    );
    const body = await listResponse.json();
    const pizzaConnector = body.data.find(
      (c: { connectorId: string }) => c.connectorId === s.pizzaConnectorId,
    );
    expect(pizzaConnector).toBeUndefined();
  });
});

// ============================================================================
// GET /api/agents/:id/connectors - Seeded agent connectors
// ============================================================================

describe("GET /api/agents/:id/connectors (seeded)", () => {
  test("returns seeded agent connectors grouped by connector (200)", async () => {
    const response = await request(`/api/agents/${s.pizzaAgentId}/connectors`, {
      headers: pizzaAdminHeaders,
    });

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.data).toBeArray();
    expect(body.data.length).toBeGreaterThanOrEqual(1);

    // Seeded agent has all 8 Medusa tools linked
    const connector = body.data[0];
    expect(connector.tools.length).toBe(8);
  });

  test("accessible by support role (200)", async () => {
    const response = await request(`/api/agents/${s.pizzaAgentId}/connectors`, {
      headers: pizzaSupportHeaders,
    });

    expect(response.status).toBe(200);
  });
});

// ============================================================================
// RLS isolation
// ============================================================================

describe("RLS isolation", () => {
  test("Burger Barn cannot see Pizza Palace agents in list", async () => {
    const response = await request("/api/agents", {
      headers: burgerAdminHeaders,
    });

    expect(response.status).toBe(200);
    const body = await response.json();

    const ids = body.data.map((a: { id: string }) => a.id);
    expect(ids).not.toContain(s.pizzaAgentId);
  });

  test("Burger Barn cannot get Pizza Palace agent by ID (404)", async () => {
    const response = await request(`/api/agents/${s.pizzaAgentId}`, {
      headers: burgerAdminHeaders,
    });

    expect(response.status).toBe(404);
  });

  test("Burger Barn cannot update Pizza Palace agent (404)", async () => {
    const response = await request(`/api/agents/${s.pizzaAgentId}`, {
      method: "PATCH",
      headers: burgerAdminHeaders,
      body: JSON.stringify({ name: "Hijacked" }),
    });

    expect(response.status).toBe(404);
  });

  test("Burger Barn cannot delete Pizza Palace agent (404)", async () => {
    const response = await request(`/api/agents/${s.pizzaAgentId}`, {
      method: "DELETE",
      headers: burgerAdminHeaders,
    });

    expect(response.status).toBe(404);
  });

  test("Burger Barn cannot assign connectors to Pizza Palace agent (404)", async () => {
    const response = await request(`/api/agents/${s.pizzaAgentId}/connectors`, {
      method: "POST",
      headers: burgerAdminHeaders,
      body: JSON.stringify({
        connectorId: s.pizzaConnectorId,
        tools: [{ name: "add_to_cart" }],
      }),
    });

    expect(response.status).toBe(404);
  });

  test("Burger Barn cannot see Pizza Palace agent connectors (404)", async () => {
    const response = await request(`/api/agents/${s.pizzaAgentId}/connectors`, {
      headers: burgerAdminHeaders,
    });

    expect(response.status).toBe(404);
  });
});
