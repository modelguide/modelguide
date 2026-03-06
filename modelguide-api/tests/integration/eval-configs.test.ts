/**
 * Integration tests for Eval Configs API.
 * Tests the full HTTP request/response cycle with RLS isolation.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import app from "@/app";
import { forApp } from "@db/rls";
import { evalConfigs, sops } from "@db/schema";
import { inArray } from "drizzle-orm";
import { type TestSeed, authHeadersFor, getTestSeed } from "../helpers/seed";

let s: TestSeed;
let orgAAdminHeaders: Record<string, string>;
let orgASupportHeaders: Record<string, string>;
let orgBAdminHeaders: Record<string, string>;
let viewerHeaders: Record<string, string>;

/** IDs of eval configs created during tests (for cleanup) */
const createdConfigIds: string[] = [];
const createdSopIds: string[] = [];

function request(path: string, options?: RequestInit) {
  return app.fetch(new Request(`http://localhost${path}`, options));
}

beforeAll(async () => {
  s = await getTestSeed();
  [orgAAdminHeaders, orgASupportHeaders, orgBAdminHeaders, viewerHeaders] =
    await Promise.all([
      authHeadersFor(s.orgAAdmin),
      authHeadersFor(s.orgASupport),
      authHeadersFor(s.orgBAdmin),
      authHeadersFor(s.demoViewer),
    ]);
});

afterAll(async () => {
  await forApp(async (tx) => {
    // Clean up SOPs first (they reference eval configs via sop_steps)
    if (createdSopIds.length > 0) {
      await tx.delete(sops).where(inArray(sops.id, createdSopIds));
    }
    if (createdConfigIds.length > 0) {
      await tx
        .delete(evalConfigs)
        .where(inArray(evalConfigs.id, createdConfigIds));
    }
  });
});

// ============================================================================
// POST /api/eval-configs — Create
// ============================================================================

describe("POST /api/eval-configs", () => {
  test("creates tool_called config (201)", async () => {
    const response = await request("/api/eval-configs", {
      method: "POST",
      headers: orgAAdminHeaders,
      body: JSON.stringify({
        name: "Check add_to_cart called",
        description: "Verifies the add_to_cart tool was invoked",
        evaluatorType: "tool_called",
        config: { connectorToolId: "00000000-0000-0000-0000-000000000001" },
      }),
    });

    expect(response.status).toBe(201);
    const body = await response.json();

    expect(body.id).toBeDefined();
    expect(body.name).toBe("Check add_to_cart called");
    expect(body.evaluatorType).toBe("tool_called");
    expect(body.config.connectorToolId).toBe(
      "00000000-0000-0000-0000-000000000001",
    );
    expect(body.createdBy).toBe(s.orgAAdmin.id);
    expect(body.createdAt).toBeDefined();

    createdConfigIds.push(body.id);
  });

  test("creates tool_input_contains config (201)", async () => {
    const response = await request("/api/eval-configs", {
      method: "POST",
      headers: orgAAdminHeaders,
      body: JSON.stringify({
        name: "Check cart quantity",
        evaluatorType: "tool_input_contains",
        config: {
          connectorToolId: "00000000-0000-0000-0000-000000000002",
          assertions: {
            quantity: { op: "gt", value: 0 },
          },
        },
      }),
    });

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.evaluatorType).toBe("tool_input_contains");
    createdConfigIds.push(body.id);
  });

  test("creates no_tool_called config (201)", async () => {
    const response = await request("/api/eval-configs", {
      method: "POST",
      headers: orgAAdminHeaders,
      body: JSON.stringify({
        name: "Ban delete_order",
        evaluatorType: "no_tool_called",
        config: { connectorToolId: "00000000-0000-0000-0000-000000000003" },
      }),
    });

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.evaluatorType).toBe("no_tool_called");
    createdConfigIds.push(body.id);
  });

  test("creates llm_judge config (201)", async () => {
    const response = await request("/api/eval-configs", {
      method: "POST",
      headers: orgAAdminHeaders,
      body: JSON.stringify({
        name: "Politeness check",
        evaluatorType: "llm_judge",
        config: {
          criterion: "Agent was polite and professional",
          rubric: { pass: "Used courteous language", fail: "Was rude" },
        },
      }),
    });

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.evaluatorType).toBe("llm_judge");
    expect(body.config.criterion).toBe("Agent was polite and professional");
    createdConfigIds.push(body.id);
  });

  test("rejects missing connectorToolId for tool_called (422)", async () => {
    const response = await request("/api/eval-configs", {
      method: "POST",
      headers: orgAAdminHeaders,
      body: JSON.stringify({
        name: "Bad config",
        evaluatorType: "tool_called",
        config: {},
      }),
    });

    expect(response.status).toBe(422);
  });

  test("rejects missing criterion for llm_judge (422)", async () => {
    const response = await request("/api/eval-configs", {
      method: "POST",
      headers: orgAAdminHeaders,
      body: JSON.stringify({
        name: "Bad LLM config",
        evaluatorType: "llm_judge",
        config: {},
      }),
    });

    expect(response.status).toBe(422);
  });

  test("support role cannot create (403)", async () => {
    const response = await request("/api/eval-configs", {
      method: "POST",
      headers: orgASupportHeaders,
      body: JSON.stringify({
        name: "Should fail",
        evaluatorType: "tool_called",
        config: { connectorToolId: "00000000-0000-0000-0000-000000000001" },
      }),
    });

    expect(response.status).toBe(403);
  });

  test("unauthenticated request returns 401", async () => {
    const response = await request("/api/eval-configs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "No auth",
        evaluatorType: "tool_called",
        config: { connectorToolId: "00000000-0000-0000-0000-000000000001" },
      }),
    });

    expect(response.status).toBe(401);
  });
});

// ============================================================================
// GET /api/eval-configs — List
// ============================================================================

describe("GET /api/eval-configs", () => {
  test("returns paginated list (200)", async () => {
    const response = await request("/api/eval-configs?page=1&pageSize=10", {
      headers: orgAAdminHeaders,
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toBeInstanceOf(Array);
    expect(body.pagination).toBeDefined();
    expect(body.pagination.page).toBe(1);
    expect(body.data.length).toBeGreaterThanOrEqual(1);
  });

  test("filters by evaluatorType", async () => {
    const response = await request(
      "/api/eval-configs?evaluatorType=tool_called",
      { headers: orgAAdminHeaders },
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    for (const item of body.data) {
      expect(item.evaluatorType).toBe("tool_called");
    }
  });

  test("viewer role can read (200)", async () => {
    const response = await request("/api/eval-configs", {
      headers: viewerHeaders,
    });

    expect(response.status).toBe(200);
  });

  test("unauthenticated GET list → 401", async () => {
    const response = await request("/api/eval-configs", {
      headers: { "Content-Type": "application/json" },
    });

    expect(response.status).toBe(401);
  });

  test("orgB cannot see orgA configs — RLS isolation (200 empty)", async () => {
    const response = await request("/api/eval-configs?page=1&pageSize=100", {
      headers: orgBAdminHeaders,
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    // orgB should not see any of the configs we created for orgA
    const orgAIds = new Set(createdConfigIds);
    for (const item of body.data) {
      expect(orgAIds.has(item.id)).toBe(false);
    }
  });
});

// ============================================================================
// GET /api/eval-configs/:configId — Get by ID
// ============================================================================

describe("GET /api/eval-configs/:configId", () => {
  test("returns config by ID (200)", async () => {
    const configId = createdConfigIds[0];
    const response = await request(`/api/eval-configs/${configId}`, {
      headers: orgAAdminHeaders,
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.id).toBe(configId);
    expect(body.name).toBe("Check add_to_cart called");
  });

  test("returns 404 for non-existent ID", async () => {
    const response = await request(
      "/api/eval-configs/00000000-0000-0000-0000-000000000099",
      { headers: orgAAdminHeaders },
    );

    expect(response.status).toBe(404);
  });

  test("orgB cannot see orgA config — RLS isolation (404)", async () => {
    const configId = createdConfigIds[0];
    const response = await request(`/api/eval-configs/${configId}`, {
      headers: orgBAdminHeaders,
    });

    expect(response.status).toBe(404);
  });
});

// ============================================================================
// PUT /api/eval-configs/:configId — Update
// ============================================================================

describe("PUT /api/eval-configs/:configId", () => {
  test("updates config name and description (200)", async () => {
    const configId = createdConfigIds[0];
    const response = await request(`/api/eval-configs/${configId}`, {
      method: "PUT",
      headers: orgAAdminHeaders,
      body: JSON.stringify({
        name: "Updated config name",
        description: "Updated description",
      }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.name).toBe("Updated config name");
    expect(body.description).toBe("Updated description");
    expect(body.updatedAt).not.toBeNull();
  });

  test("updates config JSONB (200)", async () => {
    const configId = createdConfigIds[0];
    const response = await request(`/api/eval-configs/${configId}`, {
      method: "PUT",
      headers: orgAAdminHeaders,
      body: JSON.stringify({
        config: { connectorToolId: "00000000-0000-0000-0000-000000000099" },
      }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.config.connectorToolId).toBe(
      "00000000-0000-0000-0000-000000000099",
    );
  });

  test("support role cannot update (403)", async () => {
    const configId = createdConfigIds[0];
    const response = await request(`/api/eval-configs/${configId}`, {
      method: "PUT",
      headers: orgASupportHeaders,
      body: JSON.stringify({ name: "Should fail" }),
    });

    expect(response.status).toBe(403);
  });

  test("returns 404 for non-existent ID", async () => {
    const response = await request(
      "/api/eval-configs/00000000-0000-0000-0000-000000000099",
      {
        method: "PUT",
        headers: orgAAdminHeaders,
        body: JSON.stringify({ name: "No such" }),
      },
    );

    expect(response.status).toBe(404);
  });

  test("evaluatorType in body is stripped — type unchanged (200)", async () => {
    const configId = createdConfigIds[0];
    const response = await request(`/api/eval-configs/${configId}`, {
      method: "PUT",
      headers: orgAAdminHeaders,
      body: JSON.stringify({
        name: "Attempted type change",
        evaluatorType: "llm_judge",
      }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.name).toBe("Attempted type change");
    // evaluatorType should remain tool_called (first config created)
    expect(body.evaluatorType).toBe("tool_called");
  });
});

// ============================================================================
// DELETE /api/eval-configs/:configId — Delete
// ============================================================================

describe("DELETE /api/eval-configs/:configId", () => {
  test("returns 409 when config is in use by SOP step", async () => {
    // Create a SOP that references the first eval config
    const configId = createdConfigIds[0];

    const createSopResponse = await request("/api/sops", {
      method: "POST",
      headers: orgAAdminHeaders,
      body: JSON.stringify({
        name: "Test SOP for eval delete guard",
        definition: {
          schemaVersion: 1,
          trigger: { type: "manual", config: {} },
          steps: [
            {
              id: "step-with-eval",
              order: 1,
              instruction: "Do something",
              required: true,
              evalConfigId: configId,
            },
          ],
          metadata: {},
        },
      }),
    });

    expect(createSopResponse.status).toBe(201);
    const sopBody = await createSopResponse.json();
    createdSopIds.push(sopBody.id);

    // Now try to delete — should fail with 409
    const deleteResponse = await request(`/api/eval-configs/${configId}`, {
      method: "DELETE",
      headers: orgAAdminHeaders,
    });

    expect(deleteResponse.status).toBe(409);
  });

  test("deletes unreferenced config (204)", async () => {
    // Create a fresh config that's not referenced by any SOP
    const createResponse = await request("/api/eval-configs", {
      method: "POST",
      headers: orgAAdminHeaders,
      body: JSON.stringify({
        name: "Disposable config",
        evaluatorType: "tool_called",
        config: { connectorToolId: "00000000-0000-0000-0000-000000000001" },
      }),
    });

    expect(createResponse.status).toBe(201);
    const { id: disposableId } = await createResponse.json();

    const deleteResponse = await request(`/api/eval-configs/${disposableId}`, {
      method: "DELETE",
      headers: orgAAdminHeaders,
    });

    expect(deleteResponse.status).toBe(204);

    // Verify it's gone
    const getResponse = await request(`/api/eval-configs/${disposableId}`, {
      headers: orgAAdminHeaders,
    });
    expect(getResponse.status).toBe(404);
  });

  test("support role cannot delete (403)", async () => {
    const configId = createdConfigIds[1];
    const response = await request(`/api/eval-configs/${configId}`, {
      method: "DELETE",
      headers: orgASupportHeaders,
    });

    expect(response.status).toBe(403);
  });

  test("viewer role cannot delete (403)", async () => {
    const configId = createdConfigIds[1];
    const response = await request(`/api/eval-configs/${configId}`, {
      method: "DELETE",
      headers: viewerHeaders,
    });

    expect(response.status).toBe(403);
  });

  test("unauthenticated DELETE → 401", async () => {
    const configId = createdConfigIds[1];
    const response = await request(`/api/eval-configs/${configId}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
    });

    expect(response.status).toBe(401);
  });
});
