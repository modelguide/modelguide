/**
 * Integration tests for Knowledge Base API.
 * Tests full HTTP CRUD + RLS isolation + RBAC.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import app from "@/app";
import { forApp } from "@db/rls";
import { knowledgeBase } from "@db/schema";
import { inArray } from "drizzle-orm";
import { type TestSeed, authHeadersFor, getTestSeed } from "../helpers/seed";

let s: TestSeed;
let orgAAdminHeaders: Record<string, string>;
let orgASupportHeaders: Record<string, string>;
let orgBAdminHeaders: Record<string, string>;
let viewerHeaders: Record<string, string>;

const createdIds: string[] = [];

function request(path: string, options?: RequestInit) {
  return app.fetch(new Request(`http://localhost${path}`, options));
}

const validPayload = {
  type: "guardrail",
  name: "No surname usage",
  content: "Never use the customer's surname in conversation",
  config: { priority: "high", category: "safety" },
};

beforeAll(async () => {
  s = await getTestSeed();
  orgAAdminHeaders = await authHeadersFor(s.orgAAdmin);
  orgASupportHeaders = await authHeadersFor(s.orgASupport);
  orgBAdminHeaders = await authHeadersFor(s.orgBAdmin);
  viewerHeaders = await authHeadersFor(s.demoViewer);
});

afterAll(async () => {
  if (createdIds.length > 0) {
    await forApp(async (tx) => {
      await tx
        .delete(knowledgeBase)
        .where(inArray(knowledgeBase.id, createdIds));
    });
  }
});

// ============================================================================
// POST /api/knowledge-base
// ============================================================================

describe("POST /api/knowledge-base", () => {
  test("admin creates guardrail → 201", async () => {
    const res = await request("/api/knowledge-base", {
      method: "POST",
      headers: orgAAdminHeaders,
      body: JSON.stringify(validPayload),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toBeDefined();
    expect(body.type).toBe("guardrail");
    expect(body.name).toBe("No surname usage");
    expect(body.slug).toBe("no-surname-usage");
    expect(body.content).toBe(validPayload.content);
    expect(body.config).toEqual(validPayload.config);
    expect(body.isActive).toBe(true);
    createdIds.push(body.id);
  });

  test("creates with agentIds → agents assigned", async () => {
    const res = await request("/api/knowledge-base", {
      method: "POST",
      headers: orgAAdminHeaders,
      body: JSON.stringify({
        ...validPayload,
        name: "Agent-assigned guardrail",
        agentIds: [s.orgAAgentId],
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.assignedAgents).toHaveLength(1);
    expect(body.assignedAgents[0].id).toBe(s.orgAAgentId);
    createdIds.push(body.id);
  });

  test("duplicate slug in same org+type → 409", async () => {
    const res = await request("/api/knowledge-base", {
      method: "POST",
      headers: orgAAdminHeaders,
      body: JSON.stringify(validPayload),
    });
    expect(res.status).toBe(409);
  });

  test("same slug in different org → 201", async () => {
    const res = await request("/api/knowledge-base", {
      method: "POST",
      headers: orgBAdminHeaders,
      body: JSON.stringify(validPayload),
    });
    expect(res.status).toBe(201);
    createdIds.push((await res.json()).id);
  });

  test("support cannot create → 403", async () => {
    const res = await request("/api/knowledge-base", {
      method: "POST",
      headers: orgASupportHeaders,
      body: JSON.stringify({
        ...validPayload,
        name: "Support attempt",
      }),
    });
    expect(res.status).toBe(403);
  });

  test("viewer cannot create → 403", async () => {
    const res = await request("/api/knowledge-base", {
      method: "POST",
      headers: viewerHeaders,
      body: JSON.stringify({
        ...validPayload,
        name: "Viewer attempt",
      }),
    });
    expect(res.status).toBe(403);
  });
});

// ============================================================================
// GET /api/knowledge-base
// ============================================================================

describe("GET /api/knowledge-base", () => {
  test("lists guardrails → 200 with pagination", async () => {
    const res = await request("/api/knowledge-base?type=guardrail", {
      headers: orgAAdminHeaders,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.length).toBeGreaterThanOrEqual(1);
    expect(body.pagination).toBeDefined();
    expect(body.pagination.totalItems).toBeGreaterThanOrEqual(1);
  });

  test("filters by agentId → only assigned items", async () => {
    const res = await request(`/api/knowledge-base?agentId=${s.orgAAgentId}`, {
      headers: orgAAdminHeaders,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    for (const item of body.data) {
      const agentIds = item.assignedAgents.map((a: { id: string }) => a.id);
      expect(agentIds).toContain(s.orgAAgentId);
    }
  });

  test("support can list → 200", async () => {
    const res = await request("/api/knowledge-base", {
      headers: orgASupportHeaders,
    });
    expect(res.status).toBe(200);
  });

  test("viewer can list → 200", async () => {
    const res = await request("/api/knowledge-base", {
      headers: viewerHeaders,
    });
    expect(res.status).toBe(200);
  });

  test("orgB cannot see orgA items (RLS)", async () => {
    const res = await request("/api/knowledge-base", {
      headers: orgBAdminHeaders,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    for (const item of body.data) {
      expect(item.slug).not.toBe("agent-assigned-guardrail");
    }
  });
});

// ============================================================================
// GET /api/knowledge-base/:id
// ============================================================================

describe("GET /api/knowledge-base/:id", () => {
  test("gets item by ID → 200 with agents", async () => {
    const id = createdIds[0];
    const res = await request(`/api/knowledge-base/${id}`, {
      headers: orgAAdminHeaders,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(id);
    expect(body.createdBy).toBeDefined();
  });

  test("non-existent ID → 404", async () => {
    const res = await request(
      "/api/knowledge-base/00000000-0000-0000-0000-000000000099",
      { headers: orgAAdminHeaders },
    );
    expect(res.status).toBe(404);
  });

  test("orgB cannot access orgA item → 404 (RLS)", async () => {
    const id = createdIds[0];
    const res = await request(`/api/knowledge-base/${id}`, {
      headers: orgBAdminHeaders,
    });
    expect(res.status).toBe(404);
  });
});

// ============================================================================
// PATCH /api/knowledge-base/:id
// ============================================================================

describe("PATCH /api/knowledge-base/:id", () => {
  test("admin updates name and content → 200", async () => {
    const id = createdIds[0];
    const res = await request(`/api/knowledge-base/${id}`, {
      method: "PATCH",
      headers: orgAAdminHeaders,
      body: JSON.stringify({
        name: "Updated rule",
        content: "Updated content",
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe("Updated rule");
    expect(body.content).toBe("Updated content");
  });

  test("support can update → 200", async () => {
    const id = createdIds[0];
    const res = await request(`/api/knowledge-base/${id}`, {
      method: "PATCH",
      headers: orgASupportHeaders,
      body: JSON.stringify({ isActive: false }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.isActive).toBe(false);
  });

  test("viewer cannot update → 403", async () => {
    const id = createdIds[0];
    const res = await request(`/api/knowledge-base/${id}`, {
      method: "PATCH",
      headers: viewerHeaders,
      body: JSON.stringify({ name: "Nope" }),
    });
    expect(res.status).toBe(403);
  });

  test("update with agentIds replaces assignments", async () => {
    const id = createdIds[0];
    // Assign agent
    const res1 = await request(`/api/knowledge-base/${id}`, {
      method: "PATCH",
      headers: orgAAdminHeaders,
      body: JSON.stringify({ agentIds: [s.orgAAgentId] }),
    });
    expect(res1.status).toBe(200);
    const body1 = await res1.json();
    expect(body1.assignedAgents).toHaveLength(1);

    // Remove agents
    const res2 = await request(`/api/knowledge-base/${id}`, {
      method: "PATCH",
      headers: orgAAdminHeaders,
      body: JSON.stringify({ agentIds: [] }),
    });
    expect(res2.status).toBe(200);
    const body2 = await res2.json();
    expect(body2.assignedAgents).toHaveLength(0);
  });

  test("non-existent ID → 404", async () => {
    const res = await request(
      "/api/knowledge-base/00000000-0000-0000-0000-000000000099",
      {
        method: "PATCH",
        headers: orgAAdminHeaders,
        body: JSON.stringify({ name: "Nope" }),
      },
    );
    expect(res.status).toBe(404);
  });
});

// ============================================================================
// DELETE /api/knowledge-base/:id
// ============================================================================

describe("DELETE /api/knowledge-base/:id", () => {
  test("viewer cannot delete → 403", async () => {
    const id = createdIds[0];
    const res = await request(`/api/knowledge-base/${id}`, {
      method: "DELETE",
      headers: viewerHeaders,
    });
    expect(res.status).toBe(403);
  });

  test("support cannot delete → 403", async () => {
    const id = createdIds[0];
    const res = await request(`/api/knowledge-base/${id}`, {
      method: "DELETE",
      headers: orgASupportHeaders,
    });
    expect(res.status).toBe(403);
  });

  test("admin deletes → 204", async () => {
    const id = createdIds[0];
    const res = await request(`/api/knowledge-base/${id}`, {
      method: "DELETE",
      headers: orgAAdminHeaders,
    });
    expect(res.status).toBe(204);
    // Remove from cleanup list since already deleted
    const idx = createdIds.indexOf(id);
    if (idx !== -1) createdIds.splice(idx, 1);
  });

  test("non-existent ID → 404", async () => {
    const res = await request(
      "/api/knowledge-base/00000000-0000-0000-0000-000000000099",
      {
        method: "DELETE",
        headers: orgAAdminHeaders,
      },
    );
    expect(res.status).toBe(404);
  });
});
