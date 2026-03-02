/**
 * Integration tests for SOPs API.
 * Tests the full HTTP request/response cycle with RLS isolation.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import app from "@/app";
import { forApp } from "@db/rls";
import { connectorTools, sopTemplates, sops } from "@db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { type TestSeed, authHeadersFor, getTestSeed } from "../helpers/seed";

let s: TestSeed;
let orgAAdminHeaders: Record<string, string>;
let orgASupportHeaders: Record<string, string>;
let orgBAdminHeaders: Record<string, string>;

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

  test("auto-generates slug from name (201)", async () => {
    const res = await request("/api/sops", {
      method: "POST",
      headers: orgAAdminHeaders,
      body: JSON.stringify({
        name: "Auto Slug Test",
        definition: validDefinition,
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.slug).toBe("auto-slug-test");
    createdSopIds.push(body.id);
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
      expect(sop.assignedAgents.some((a: any) => a.id === s.orgAAgentId)).toBe(
        true,
      );
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
// Versions
// ============================================================================

describe("SOP versions", () => {
  test("create version snapshot (201)", async () => {
    const sopId = createdSopIds[0];
    const res = await request(`/api/sops/${sopId}/versions`, {
      method: "POST",
      headers: orgAAdminHeaders,
      body: JSON.stringify({ changeSummary: "Initial snapshot" }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.sopId).toBe(sopId);
    expect(body.changeSummary).toBe("Initial snapshot");
    expect(body.definition).toBeDefined();
  });

  test("list versions (200)", async () => {
    const sopId = createdSopIds[0];
    const res = await request(`/api/sops/${sopId}/versions`, {
      headers: orgAAdminHeaders,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toBeArray();
    expect(body.data.length).toBeGreaterThan(0);
  });

  test("get version by id (200)", async () => {
    const sopId = createdSopIds[0];
    // First get version list
    const listRes = await request(`/api/sops/${sopId}/versions`, {
      headers: orgAAdminHeaders,
    });
    const list = await listRes.json();
    const versionId = list.data[0].id;

    const res = await request(`/api/sops/${sopId}/versions/${versionId}`, {
      headers: orgAAdminHeaders,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(versionId);
  });

  test("orgB cannot access orgA SOP versions (404)", async () => {
    const sopId = createdSopIds[0];
    const res = await request(`/api/sops/${sopId}/versions`, {
      headers: orgBAdminHeaders,
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
    expect(body.templateId).toBe(createdTemplateIds[0]);
    expect(body.definition.steps.length).toBeGreaterThan(0);

    // Check resolved tool name
    const toolStep = body.definition.steps.find(
      (s: any) => s.tool?.resolvedName,
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
            toolSlug: "get_order",
            connectorId: s.orgAMedusaConnectorId,
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
    expect(toolStep.tool.resolvedName).toBe("glowbox_store_get_order");
  });

  test("rejects update with invalid connector reference (400)", async () => {
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
            toolSlug: "get_order",
            connectorId: "00000000-0000-0000-0000-000000000000",
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
                toolSlug: "get_order",
                connectorId: s.orgAMedusaConnectorId,
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
});
