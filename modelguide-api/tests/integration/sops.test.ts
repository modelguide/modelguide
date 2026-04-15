/**
 * Integration tests for SOPs API.
 * Tests the full HTTP request/response cycle with RLS isolation.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import app from "@/app";
import { forApp } from "@db/rls";
import { connectorTools, connectors, sopTemplates, sops } from "@db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { type TestSeed, authHeadersFor, getTestSeed } from "../helpers/seed";

let s: TestSeed;
let orgAAdminHeaders: Record<string, string>;
let orgASupportHeaders: Record<string, string>;
let orgBAdminHeaders: Record<string, string>;
let viewerHeaders: Record<string, string>;
/** connector_tools.id for get_order on orgA's Medusa connector */
let orgAGetOrderToolId: string;

/** IDs of SOPs created during tests (for cleanup) */
const createdSopIds: string[] = [];
const createdTemplateIds: string[] = [];

function request(path: string, options?: RequestInit) {
  return app.fetch(new Request(`http://localhost${path}`, options));
}

beforeAll(async () => {
  s = await getTestSeed();
  orgAAdminHeaders = await authHeadersFor(s.orgAAdmin);
  orgASupportHeaders = await authHeadersFor(s.orgASupport);
  orgBAdminHeaders = await authHeadersFor(s.orgBAdmin);
  viewerHeaders = await authHeadersFor(s.demoViewer);

  // Look up connector_tools.id for get_order on orgA's Medusa connector
  const [tool] = await forApp(async (tx) =>
    tx
      .select({ id: connectorTools.id })
      .from(connectorTools)
      .where(
        and(
          eq(connectorTools.connectorId, s.orgAMedusaConnectorId),
          eq(connectorTools.slug, "get_order"),
        ),
      ),
  );
  orgAGetOrderToolId = tool.id;

  // Seed a test SOP template
  await forApp(async (tx) => {
    const [tpl] = await tx
      .insert(sopTemplates)
      .values({
        name: "Test Order Lookup Template",
        slug: "test-order-lookup-tpl",
        description: "Test template",
        catalogSlugs: ["medusa"],
        definition: {
          schemaVersion: 1,
          trigger: { type: "manual", config: {} },
          steps: [
            {
              id: "greet",
              order: 1,
              instruction: "Greet the customer",
              required: true,
            },
            {
              id: "lookup",
              order: 2,
              instruction: "Look up order",
              required: true,
              tool: { toolSlug: "get_order", catalogSlug: "medusa" },
            },
          ],
          metadata: { reasonCode: "TEST-001" },
        },
        version: "1.0",
        isActive: true,
      })
      .onConflictDoNothing()
      .returning();
    if (tpl) createdTemplateIds.push(tpl.id);
  });
});

afterAll(async () => {
  await forApp(async (tx) => {
    if (createdSopIds.length > 0) {
      await tx.delete(sops).where(inArray(sops.id, createdSopIds));
    }
    if (createdTemplateIds.length > 0) {
      await tx
        .delete(sopTemplates)
        .where(inArray(sopTemplates.id, createdTemplateIds));
    }
  });
});

const validDefinition = {
  schemaVersion: 1,
  trigger: { type: "manual" as const, config: {} },
  steps: [
    {
      id: "step-1",
      order: 1,
      instruction: "Greet the customer",
      required: true,
    },
  ],
  metadata: {},
};

// ============================================================================
// GET /api/sops/templates
// ============================================================================

describe("GET /api/sops/templates", () => {
  test("returns templates with pagination (200)", async () => {
    const res = await request("/api/sops/templates", {
      headers: orgAAdminHeaders,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toBeArray();
    expect(body.pagination).toBeDefined();
  });

  test("rejects unauthenticated request (401)", async () => {
    const res = await request("/api/sops/templates");
    expect(res.status).toBe(401);
  });
});

// ============================================================================
// POST /api/sops - Create SOP
// ============================================================================

describe("POST /api/sops", () => {
  test("creates SOP from scratch (201)", async () => {
    const res = await request("/api/sops", {
      method: "POST",
      headers: orgAAdminHeaders,
      body: JSON.stringify({
        name: "Test SOP Integration",
        slug: "test-sop-integration",
        definition: validDefinition,
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toBeDefined();
    expect(body.name).toBe("Test SOP Integration");
    expect(body.slug).toBe("test-sop-integration");
    expect(body.status).toBe("draft");
    expect(body.definition.steps).toHaveLength(1);
    createdSopIds.push(body.id);
  });

  test("rejects missing slug (422)", async () => {
    const res = await request("/api/sops", {
      method: "POST",
      headers: orgAAdminHeaders,
      body: JSON.stringify({
        name: "Auto Slug Test",
        definition: validDefinition,
      }),
    });
    expect(res.status).toBe(422);
  });

  test("rejects duplicate slug (409)", async () => {
    const res = await request("/api/sops", {
      method: "POST",
      headers: orgAAdminHeaders,
      body: JSON.stringify({
        name: "Duplicate",
        slug: "test-sop-integration",
        definition: validDefinition,
      }),
    });
    expect(res.status).toBe(409);
  });

  test("support role cannot create (403)", async () => {
    const res = await request("/api/sops", {
      method: "POST",
      headers: orgASupportHeaders,
      body: JSON.stringify({
        name: "Blocked",
        slug: "blocked",
        definition: validDefinition,
      }),
    });
    expect(res.status).toBe(403);
  });

  test("creates with agent assignment (201)", async () => {
    const res = await request("/api/sops", {
      method: "POST",
      headers: orgAAdminHeaders,
      body: JSON.stringify({
        name: "SOP With Agent",
        slug: "sop-with-agent",
        definition: validDefinition,
        agentIds: [s.orgAAgentId],
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.assignedAgents).toHaveLength(1);
    expect(body.assignedAgents[0].id).toBe(s.orgAAgentId);
    createdSopIds.push(body.id);
  });

  test("deduplicates duplicate agentIds (201)", async () => {
    const res = await request("/api/sops", {
      method: "POST",
      headers: orgAAdminHeaders,
      body: JSON.stringify({
        name: "SOP With Duplicate Agents",
        slug: "sop-with-duplicate-agents",
        definition: validDefinition,
        agentIds: [s.orgAAgentId, s.orgAAgentId],
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.assignedAgents).toHaveLength(1);
    expect(body.assignedAgents[0].id).toBe(s.orgAAgentId);
    createdSopIds.push(body.id);
  });
});

// ============================================================================
// GET /api/sops - List SOPs
// ============================================================================

describe("GET /api/sops", () => {
  test("returns paginated list (200)", async () => {
    const res = await request("/api/sops", {
      headers: orgAAdminHeaders,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toBeArray();
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.pagination).toBeDefined();
  });

  test("filters by status", async () => {
    const res = await request("/api/sops?status=draft", {
      headers: orgAAdminHeaders,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    for (const sop of body.data) {
      expect(sop.status).toBe("draft");
    }
  });

  test("filters by agentId", async () => {
    const res = await request(`/api/sops?agentId=${s.orgAAgentId}`, {
      headers: orgAAdminHeaders,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    for (const sop of body.data) {
      expect(
        sop.assignedAgents.some((a: { id: string }) => a.id === s.orgAAgentId),
      ).toBe(true);
    }
  });

  test("orgB cannot see orgA SOPs (RLS isolation)", async () => {
    const res = await request("/api/sops", {
      headers: orgBAdminHeaders,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    // OrgB should have no SOPs (we only created for orgA)
    for (const sop of body.data) {
      expect(sop.slug).not.toBe("test-sop-integration");
    }
  });
});

// ============================================================================
// GET /api/sops/:id - Get SOP
// ============================================================================

describe("GET /api/sops/:id", () => {
  test("returns SOP detail (200)", async () => {
    const sopId = createdSopIds[0];
    const res = await request(`/api/sops/${sopId}`, {
      headers: orgAAdminHeaders,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(sopId);
    expect(body.definition).toBeDefined();
    expect(body.definition.schemaVersion).toBe(1);
  });

  test("orgB cannot see orgA SOP (404)", async () => {
    const sopId = createdSopIds[0];
    const res = await request(`/api/sops/${sopId}`, {
      headers: orgBAdminHeaders,
    });
    expect(res.status).toBe(404);
  });
});

// ============================================================================
// PATCH /api/sops/:id - Update SOP
// ============================================================================

describe("PATCH /api/sops/:id", () => {
  test("updates name (200)", async () => {
    const sopId = createdSopIds[0];
    const res = await request(`/api/sops/${sopId}`, {
      method: "PATCH",
      headers: orgAAdminHeaders,
      body: JSON.stringify({ name: "Updated SOP Name" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe("Updated SOP Name");
  });

  test("support can update (200)", async () => {
    const sopId = createdSopIds[0];
    const res = await request(`/api/sops/${sopId}`, {
      method: "PATCH",
      headers: orgASupportHeaders,
      body: JSON.stringify({ description: "Updated by support" }),
    });
    expect(res.status).toBe(200);
  });

  test("updates definition (200)", async () => {
    const sopId = createdSopIds[0];
    const newDef = {
      ...validDefinition,
      steps: [
        ...validDefinition.steps,
        {
          id: "step-2",
          order: 2,
          instruction: "New step",
          required: false,
        },
      ],
    };
    const res = await request(`/api/sops/${sopId}`, {
      method: "PATCH",
      headers: orgAAdminHeaders,
      body: JSON.stringify({ definition: newDef }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.definition.steps).toHaveLength(2);
  });

  test("updates assigned agents with agentIds only (200)", async () => {
    const createRes = await request("/api/sops", {
      method: "POST",
      headers: orgAAdminHeaders,
      body: JSON.stringify({
        name: "Patch Agent Assignments",
        slug: `patch-agent-assignments-${Date.now()}`,
        definition: validDefinition,
        agentIds: [s.orgAAgentId],
      }),
    });
    expect(createRes.status).toBe(201);
    const created = await createRes.json();
    createdSopIds.push(created.id);

    const patchRes = await request(`/api/sops/${created.id}`, {
      method: "PATCH",
      headers: orgAAdminHeaders,
      body: JSON.stringify({ agentIds: [] }),
    });
    expect(patchRes.status).toBe(200);
    const body = await patchRes.json();
    expect(body.assignedAgents).toEqual([]);
  });

  test("returns 404 for non-existent SOP when definition is provided", async () => {
    const fakeId = "00000000-0000-0000-0000-000000000000";
    const res = await request(`/api/sops/${fakeId}`, {
      method: "PATCH",
      headers: orgAAdminHeaders,
      body: JSON.stringify({
        definition: {
          schemaVersion: 1,
          trigger: { type: "manual", config: {} },
          steps: [
            {
              id: "step-1",
              order: 1,
              instruction: "Will not be written",
              required: true,
            },
          ],
          metadata: {},
        },
      }),
    });
    expect(res.status).toBe(404);
  });
});

// ============================================================================
// Status lifecycle
// ============================================================================

describe("SOP status lifecycle", () => {
  test("activate → active (200)", async () => {
    const sopId = createdSopIds[0];
    const res = await request(`/api/sops/${sopId}/activate`, {
      method: "POST",
      headers: orgAAdminHeaders,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("active");
  });

  test("archive → archived (200)", async () => {
    const sopId = createdSopIds[0];
    const res = await request(`/api/sops/${sopId}/archive`, {
      method: "POST",
      headers: orgAAdminHeaders,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("archived");
  });

  test("reactivate → active (200)", async () => {
    const sopId = createdSopIds[0];
    const res = await request(`/api/sops/${sopId}/activate`, {
      method: "POST",
      headers: orgAAdminHeaders,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("active");
  });

  test("deactivate → draft (200)", async () => {
    const sopId = createdSopIds[0];

    const activateRes = await request(`/api/sops/${sopId}/activate`, {
      method: "POST",
      headers: orgAAdminHeaders,
    });
    expect(activateRes.status).toBe(200);

    const res = await request(`/api/sops/${sopId}/deactivate`, {
      method: "POST",
      headers: orgAAdminHeaders,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("draft");
  });

  test("cannot activate SOP with no steps (400)", async () => {
    // Create a new SOP with empty steps
    const createRes = await request("/api/sops", {
      method: "POST",
      headers: orgAAdminHeaders,
      body: JSON.stringify({
        name: "Empty SOP",
        slug: "empty-sop-activation-test",
        definition: {
          schemaVersion: 1,
          trigger: { type: "manual", config: {} },
          steps: [],
          metadata: {},
        },
      }),
    });
    const created = await createRes.json();
    createdSopIds.push(created.id);

    const res = await request(`/api/sops/${created.id}/activate`, {
      method: "POST",
      headers: orgAAdminHeaders,
    });
    expect(res.status).toBe(400);
  });
});

// ============================================================================
// Agent assignments
// ============================================================================

describe("SOP agent assignments", () => {
  test("set agents (PUT) replaces all (200)", async () => {
    const sopId = createdSopIds[0];
    const res = await request(`/api/sops/${sopId}/agents`, {
      method: "PUT",
      headers: orgAAdminHeaders,
      body: JSON.stringify({ agentIds: [s.orgAAgentId] }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe(s.orgAAgentId);
  });

  test("get agents (200)", async () => {
    const sopId = createdSopIds[0];
    const res = await request(`/api/sops/${sopId}/agents`, {
      headers: orgAAdminHeaders,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(1);
  });

  test("clear agents by setting empty array (200)", async () => {
    const sopId = createdSopIds[0];
    const res = await request(`/api/sops/${sopId}/agents`, {
      method: "PUT",
      headers: orgAAdminHeaders,
      body: JSON.stringify({ agentIds: [] }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(0);
  });

  test("rejects cross-org agent assignment (404)", async () => {
    const sopId = createdSopIds[0];
    const res = await request(`/api/sops/${sopId}/agents`, {
      method: "PUT",
      headers: orgAAdminHeaders,
      body: JSON.stringify({ agentIds: [s.orgBAgentId] }),
    });
    expect(res.status).toBe(404);
  });
});

// ============================================================================
// Fork from template
// ============================================================================

describe("POST /api/sops/from-template/:templateId", () => {
  test("forks template with connector mapping (201)", async () => {
    if (createdTemplateIds.length === 0) return; // skip if template creation failed

    const res = await request(
      `/api/sops/from-template/${createdTemplateIds[0]}`,
      {
        method: "POST",
        headers: orgAAdminHeaders,
        body: JSON.stringify({
          name: "Forked Order Lookup",
          slug: "forked-order-lookup",
          connectorMapping: {
            medusa: s.orgAMedusaConnectorId,
          },
        }),
      },
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.name).toBe("Forked Order Lookup");
    expect(body.sopTemplateId).toBe(createdTemplateIds[0]);
    expect(body.definition.steps.length).toBeGreaterThan(0);

    // Check resolved tool name
    const toolStep = body.definition.steps.find(
      (s: { tool?: { resolvedName?: string } }) => s.tool?.resolvedName,
    );
    expect(toolStep).toBeDefined();
    expect(toolStep.tool.resolvedName).toContain("_get_order");
    createdSopIds.push(body.id);
  });

  test("rejects fork with missing connector mapping (400)", async () => {
    if (createdTemplateIds.length === 0) return;

    const res = await request(
      `/api/sops/from-template/${createdTemplateIds[0]}`,
      {
        method: "POST",
        headers: orgAAdminHeaders,
        body: JSON.stringify({
          name: "Bad Fork",
          slug: "bad-fork",
          connectorMapping: {}, // medusa mapping missing
        }),
      },
    );
    expect(res.status).toBe(400);
  });

  test("rejects fork from non-existent template (404)", async () => {
    const fakeId = "00000000-0000-0000-0000-000000000000";
    const res = await request(`/api/sops/from-template/${fakeId}`, {
      method: "POST",
      headers: orgAAdminHeaders,
      body: JSON.stringify({
        connectorMapping: {},
      }),
    });
    expect(res.status).toBe(404);
  });
});

// ============================================================================
// DELETE /api/sops/:id
// ============================================================================

describe("DELETE /api/sops/:id", () => {
  test("support cannot delete (403)", async () => {
    const sopId = createdSopIds[0];
    const res = await request(`/api/sops/${sopId}`, {
      method: "DELETE",
      headers: orgASupportHeaders,
    });
    expect(res.status).toBe(403);
  });

  test("deletes SOP (204)", async () => {
    // Create a throwaway SOP
    const createRes = await request("/api/sops", {
      method: "POST",
      headers: orgAAdminHeaders,
      body: JSON.stringify({
        name: "To Delete",
        slug: "to-delete-sop",
        definition: validDefinition,
      }),
    });
    const created = await createRes.json();

    const res = await request(`/api/sops/${created.id}`, {
      method: "DELETE",
      headers: orgAAdminHeaders,
    });
    expect(res.status).toBe(204);

    // Verify it's gone
    const getRes = await request(`/api/sops/${created.id}`, {
      headers: orgAAdminHeaders,
    });
    expect(getRes.status).toBe(404);
  });

  test("orgB cannot delete orgA SOP (404)", async () => {
    const sopId = createdSopIds[0];
    const res = await request(`/api/sops/${sopId}`, {
      method: "DELETE",
      headers: orgBAdminHeaders,
    });
    expect(res.status).toBe(404);
  });
});

// ============================================================================
// PATCH with tool references (validateAndResolveSteps during update)
// ============================================================================

describe("PATCH /api/sops/:id with tool references", () => {
  test("validates and resolves tool references on definition update (200)", async () => {
    const sopId = createdSopIds[0];
    const newDef = {
      schemaVersion: 1,
      trigger: { type: "manual" as const, config: {} },
      steps: [
        {
          id: "step-with-tool",
          order: 1,
          instruction: "Look up order",
          required: true,
          tool: {
            connectorToolId: orgAGetOrderToolId,
          },
        },
      ],
      metadata: {},
    };
    const res = await request(`/api/sops/${sopId}`, {
      method: "PATCH",
      headers: orgAAdminHeaders,
      body: JSON.stringify({ definition: newDef }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    const toolStep = body.definition.steps[0];
    expect(toolStep.tool.connectorToolId).toBe(orgAGetOrderToolId);
    expect(toolStep.tool.resolvedName).toBe("glowbox_store_get_order");
  });

  test("rejects update with invalid connector tool reference (400)", async () => {
    const sopId = createdSopIds[0];
    const newDef = {
      schemaVersion: 1,
      trigger: { type: "manual" as const, config: {} },
      steps: [
        {
          id: "bad-ref",
          order: 1,
          instruction: "This should fail",
          required: true,
          tool: {
            connectorToolId: "00000000-0000-0000-0000-000000000000",
          },
        },
      ],
      metadata: {},
    };
    const res = await request(`/api/sops/${sopId}`, {
      method: "PATCH",
      headers: orgAAdminHeaders,
      body: JSON.stringify({ definition: newDef }),
    });
    expect(res.status).toBe(400);
  });
});

// ============================================================================
// Step warnings for inactive tools
// ============================================================================

describe("SOP step warnings", () => {
  let warningTestSopId: string;

  test("creates SOP with tool reference for warning test", async () => {
    const res = await request("/api/sops", {
      method: "POST",
      headers: orgAAdminHeaders,
      body: JSON.stringify({
        name: "Warning Test SOP",
        slug: "warning-test-sop",
        definition: {
          schemaVersion: 1,
          trigger: { type: "manual", config: {} },
          steps: [
            {
              id: "tool-step",
              order: 1,
              instruction: "Look up order",
              required: true,
              tool: {
                connectorToolId: orgAGetOrderToolId,
              },
            },
          ],
          metadata: {},
        },
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    warningTestSopId = body.id;
    createdSopIds.push(body.id);
    // Initially no warnings
    expect(body.stepWarnings ?? []).toHaveLength(0);
  });

  test("shows warning when tool is deactivated", async () => {
    // Deactivate the get_order tool
    await forApp(async (tx) => {
      await tx
        .update(connectorTools)
        .set({ isActive: false })
        .where(
          and(
            eq(connectorTools.connectorId, s.orgAMedusaConnectorId),
            eq(connectorTools.slug, "get_order"),
          ),
        );
    });

    const res = await request(`/api/sops/${warningTestSopId}`, {
      headers: orgAAdminHeaders,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.stepWarnings.length).toBeGreaterThan(0);
    expect(body.stepWarnings[0].stepId).toBe("tool-step");
    expect(body.stepWarnings[0].message).toContain("inactive");

    // Reactivate the tool for other tests
    await forApp(async (tx) => {
      await tx
        .update(connectorTools)
        .set({ isActive: true })
        .where(
          and(
            eq(connectorTools.connectorId, s.orgAMedusaConnectorId),
            eq(connectorTools.slug, "get_order"),
          ),
        );
    });
  });

  test("shows warning when connector is deactivated", async () => {
    // Deactivate the parent connector (tool stays active)
    await forApp(async (tx) => {
      await tx
        .update(connectors)
        .set({ isActive: false })
        .where(eq(connectors.id, s.orgAMedusaConnectorId));
    });

    const res = await request(`/api/sops/${warningTestSopId}`, {
      headers: orgAAdminHeaders,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.stepWarnings.length).toBeGreaterThan(0);
    expect(body.stepWarnings[0].stepId).toBe("tool-step");
    expect(body.stepWarnings[0].message).toContain("inactive");

    // Reactivate connector
    await forApp(async (tx) => {
      await tx
        .update(connectors)
        .set({ isActive: true })
        .where(eq(connectors.id, s.orgAMedusaConnectorId));
    });
  });

  test("shows warning when tool is soft-deleted", async () => {
    // Soft-delete the get_order tool
    await forApp(async (tx) => {
      await tx
        .update(connectorTools)
        .set({ deletedAt: new Date() })
        .where(
          and(
            eq(connectorTools.connectorId, s.orgAMedusaConnectorId),
            eq(connectorTools.slug, "get_order"),
          ),
        );
    });

    const res = await request(`/api/sops/${warningTestSopId}`, {
      headers: orgAAdminHeaders,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.stepWarnings.length).toBeGreaterThan(0);
    expect(body.stepWarnings[0].stepId).toBe("tool-step");
    expect(body.stepWarnings[0].message).toContain("no longer exists");

    // Restore the tool
    await forApp(async (tx) => {
      await tx
        .update(connectorTools)
        .set({ deletedAt: null })
        .where(
          and(
            eq(connectorTools.connectorId, s.orgAMedusaConnectorId),
            eq(connectorTools.slug, "get_order"),
          ),
        );
    });
  });
});

// ============================================================================
// GET /api/sops/templates/:templateId
// ============================================================================

describe("GET /api/sops/templates/:templateId", () => {
  test("returns template detail (200)", async () => {
    if (createdTemplateIds.length === 0) return;
    const res = await request(`/api/sops/templates/${createdTemplateIds[0]}`, {
      headers: orgAAdminHeaders,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(createdTemplateIds[0]);
    expect(body.name).toBe("Test Order Lookup Template");
    expect(body.slug).toBe("test-order-lookup-tpl");
    expect(body.definition).toBeDefined();
    expect(body.definition.steps).toHaveLength(2);
  });

  test("returns 404 for non-existent template", async () => {
    const fakeId = "00000000-0000-0000-0000-000000000000";
    const res = await request(`/api/sops/templates/${fakeId}`, {
      headers: orgAAdminHeaders,
    });
    expect(res.status).toBe(404);
  });

  test("rejects unauthenticated request (401)", async () => {
    if (createdTemplateIds.length === 0) return;
    const res = await request(`/api/sops/templates/${createdTemplateIds[0]}`);
    expect(res.status).toBe(401);
  });
});

// ============================================================================
// Duplicate step IDs (validateUniqueStepIds)
// ============================================================================

describe("Duplicate step ID validation", () => {
  test("rejects create with duplicate step IDs (400)", async () => {
    const res = await request("/api/sops", {
      method: "POST",
      headers: orgAAdminHeaders,
      body: JSON.stringify({
        name: "Duplicate Step IDs",
        slug: "duplicate-step-ids",
        definition: {
          schemaVersion: 1,
          trigger: { type: "manual", config: {} },
          steps: [
            { id: "step-a", order: 1, instruction: "First", required: true },
            { id: "step-a", order: 2, instruction: "Dupe", required: true },
          ],
          metadata: {},
        },
      }),
    });
    expect(res.status).toBe(400);
  });

  test("rejects update with duplicate step IDs (400)", async () => {
    const sopId = createdSopIds[0];
    const res = await request(`/api/sops/${sopId}`, {
      method: "PATCH",
      headers: orgAAdminHeaders,
      body: JSON.stringify({
        definition: {
          schemaVersion: 1,
          trigger: { type: "manual", config: {} },
          steps: [
            { id: "dup", order: 1, instruction: "First", required: true },
            { id: "dup", order: 2, instruction: "Dupe", required: false },
          ],
          metadata: {},
        },
      }),
    });
    expect(res.status).toBe(400);
  });
});

// ============================================================================
// 404 on non-existent SOP for activate, archive, agents
// ============================================================================

describe("404 for non-existent SOP", () => {
  const fakeId = "00000000-0000-0000-0000-000000000000";

  test("activate returns 404", async () => {
    const res = await request(`/api/sops/${fakeId}/activate`, {
      method: "POST",
      headers: orgAAdminHeaders,
    });
    expect(res.status).toBe(404);
  });

  test("archive returns 404", async () => {
    const res = await request(`/api/sops/${fakeId}/archive`, {
      method: "POST",
      headers: orgAAdminHeaders,
    });
    expect(res.status).toBe(404);
  });

  test("deactivate returns 404", async () => {
    const res = await request(`/api/sops/${fakeId}/deactivate`, {
      method: "POST",
      headers: orgAAdminHeaders,
    });
    expect(res.status).toBe(404);
  });

  test("get agents returns 404", async () => {
    const res = await request(`/api/sops/${fakeId}/agents`, {
      headers: orgAAdminHeaders,
    });
    expect(res.status).toBe(404);
  });

  test("set agents returns 404", async () => {
    const res = await request(`/api/sops/${fakeId}/agents`, {
      method: "PUT",
      headers: orgAAdminHeaders,
      body: JSON.stringify({ agentIds: [] }),
    });
    expect(res.status).toBe(404);
  });

  test("delete returns 404", async () => {
    const res = await request(`/api/sops/${fakeId}`, {
      method: "DELETE",
      headers: orgAAdminHeaders,
    });
    expect(res.status).toBe(404);
  });
});

// ============================================================================
// Viewer role permissions
// ============================================================================

describe("Viewer role access", () => {
  test("viewer can list SOPs (200)", async () => {
    const res = await request("/api/sops", { headers: viewerHeaders });
    expect(res.status).toBe(200);
  });

  test("viewer can get SOP detail (200)", async () => {
    const sopId = createdSopIds[0];
    const res = await request(`/api/sops/${sopId}`, {
      headers: viewerHeaders,
    });
    expect(res.status).toBe(200);
  });

  test("viewer cannot create SOP (403)", async () => {
    const res = await request("/api/sops", {
      method: "POST",
      headers: viewerHeaders,
      body: JSON.stringify({
        name: "Viewer Attempt",
        slug: "viewer-attempt",
        definition: validDefinition,
      }),
    });
    expect(res.status).toBe(403);
  });

  test("viewer cannot update SOP (403)", async () => {
    const sopId = createdSopIds[0];
    const res = await request(`/api/sops/${sopId}`, {
      method: "PATCH",
      headers: viewerHeaders,
      body: JSON.stringify({ name: "Viewer Update" }),
    });
    expect(res.status).toBe(403);
  });

  test("viewer cannot delete SOP (403)", async () => {
    const sopId = createdSopIds[0];
    const res = await request(`/api/sops/${sopId}`, {
      method: "DELETE",
      headers: viewerHeaders,
    });
    expect(res.status).toBe(403);
  });

  test("viewer cannot activate SOP (403)", async () => {
    const sopId = createdSopIds[0];
    const res = await request(`/api/sops/${sopId}/activate`, {
      method: "POST",
      headers: viewerHeaders,
    });
    expect(res.status).toBe(403);
  });

  test("viewer cannot deactivate SOP (403)", async () => {
    const sopId = createdSopIds[0];
    const res = await request(`/api/sops/${sopId}/deactivate`, {
      method: "POST",
      headers: viewerHeaders,
    });
    expect(res.status).toBe(403);
  });
});

// ============================================================================
// Fork with overrides and agent assignment
// ============================================================================

describe("Fork with overrides and agents", () => {
  test("fork with trigger override applies override (201)", async () => {
    if (createdTemplateIds.length === 0) return;

    const res = await request(
      `/api/sops/from-template/${createdTemplateIds[0]}`,
      {
        method: "POST",
        headers: orgAAdminHeaders,
        body: JSON.stringify({
          name: "Forked With Override",
          slug: "forked-with-override",
          connectorMapping: { medusa: s.orgAMedusaConnectorId },
          overrides: {
            trigger: {
              type: "intent_detected",
              config: { patterns: ["where is my order"] },
            },
          },
        }),
      },
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.definition.trigger.type).toBe("intent_detected");
    expect(body.definition.trigger.config.patterns).toContain(
      "where is my order",
    );
    createdSopIds.push(body.id);
  });

  test("fork with agent assignment (201)", async () => {
    if (createdTemplateIds.length === 0) return;

    const res = await request(
      `/api/sops/from-template/${createdTemplateIds[0]}`,
      {
        method: "POST",
        headers: orgAAdminHeaders,
        body: JSON.stringify({
          name: "Forked With Agent",
          slug: "forked-with-agent",
          connectorMapping: { medusa: s.orgAMedusaConnectorId },
          agentIds: [s.orgAAgentId],
        }),
      },
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.assignedAgents).toHaveLength(1);
    expect(body.assignedAgents[0].id).toBe(s.orgAAgentId);
    createdSopIds.push(body.id);
  });

  test("fork rejects duplicate slug (409)", async () => {
    if (createdTemplateIds.length === 0) return;

    const res = await request(
      `/api/sops/from-template/${createdTemplateIds[0]}`,
      {
        method: "POST",
        headers: orgAAdminHeaders,
        body: JSON.stringify({
          name: "Duplicate Fork",
          slug: "forked-with-agent", // already used above
          connectorMapping: { medusa: s.orgAMedusaConnectorId },
        }),
      },
    );
    expect(res.status).toBe(409);
  });
});

// ============================================================================
// CRUD audit — strict validation (#64)
// ============================================================================

describe("Strict PATCH schema", () => {
  test("rejects unknown fields with 422", async () => {
    const sopId = createdSopIds[0];

    const response = await request(`/api/sops/${sopId}`, {
      method: "PATCH",
      headers: orgAAdminHeaders,
      body: JSON.stringify({ name: "Updated", phantom: "field" }),
    });

    expect(response.status).toBe(422);
  });
});
