/**
 * Integration tests for Connectors API
 * Tests the full HTTP request/response cycle with RLS isolation
 */

import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import app from "@/app";
import { forApp } from "@db/rls";
import { connectors } from "@db/schema";
import { loadAllManifests } from "@features/connectors/catalog/registry";
import { eq } from "drizzle-orm";
import { type TestSeed, authHeadersFor, getTestSeed } from "../helpers/seed";

let s: TestSeed;
let orgAAdminHeaders: Record<string, string>;
let orgASupportHeaders: Record<string, string>;
let orgBAdminHeaders: Record<string, string>;

/** IDs of connectors created during tests (for cleanup) */
const createdConnectorIds: string[] = [];

function request(path: string, options?: RequestInit) {
  return app.fetch(new Request(`http://localhost${path}`, options));
}

beforeAll(async () => {
  s = await getTestSeed();
  orgAAdminHeaders = await authHeadersFor(s.orgAAdmin);
  orgASupportHeaders = await authHeadersFor(s.orgASupport);
  orgBAdminHeaders = await authHeadersFor(s.orgBAdmin);
  await loadAllManifests();
});

afterAll(async () => {
  if (createdConnectorIds.length > 0) {
    await forApp(async (tx) => {
      for (const id of createdConnectorIds) {
        // Tools are cascade-deleted by FK
        await tx.delete(connectors).where(eq(connectors.id, id));
      }
    });
  }
});

// ============================================================================
// GET /api/connectors/catalog - List catalog
// ============================================================================

describe("GET /api/connectors/catalog", () => {
  test("returns active catalog entries with pagination (200)", async () => {
    const response = await request("/api/connectors/catalog", {
      headers: orgAAdminHeaders,
    });

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.data).toBeArray();
    expect(body.data.length).toBeGreaterThanOrEqual(1);
    expect(body.pagination).toBeDefined();
    expect(body.pagination.page).toBe(1);

    const entry = body.data[0];
    expect(entry.id).toBeDefined();
    expect(entry.name).toBeDefined();
    expect(entry.slug).toBeDefined();
    expect(entry.tools).toBeArray();
  });

  test("accessible by support role (200)", async () => {
    const response = await request("/api/connectors/catalog", {
      headers: orgASupportHeaders,
    });

    expect(response.status).toBe(200);
  });

  test("rejects unauthenticated request (401)", async () => {
    const response = await request("/api/connectors/catalog");

    expect(response.status).toBe(401);
  });
});

// ============================================================================
// GET /api/connectors/catalog/:catalogId - Get catalog entry
// ============================================================================

describe("GET /api/connectors/catalog/:catalogId", () => {
  test("returns single catalog entry with tools array (200)", async () => {
    const response = await request(
      `/api/connectors/catalog/${s.medusaCatalogId}`,
      {
        headers: orgAAdminHeaders,
      },
    );

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.id).toBe(s.medusaCatalogId);
    expect(body.name).toBeDefined();
    expect(body.slug).toBeDefined();
    expect(body.tools).toBeArray();
    expect(body.tools.length).toBeGreaterThan(0);
    expect(body.configSchema).toBeDefined();
  });

  test("returns 404 for non-existent catalog entry", async () => {
    const fakeId = "00000000-0000-0000-0000-000000000000";
    const response = await request(`/api/connectors/catalog/${fakeId}`, {
      headers: orgAAdminHeaders,
    });

    expect(response.status).toBe(404);
  });

  test("accessible by support role (200)", async () => {
    const response = await request(
      `/api/connectors/catalog/${s.medusaCatalogId}`,
      {
        headers: orgASupportHeaders,
      },
    );

    expect(response.status).toBe(200);
  });
});

// ============================================================================
// POST /api/connectors - Create connector
// ============================================================================

describe("POST /api/connectors", () => {
  test("creates connector instance (201)", async () => {
    const response = await request("/api/connectors", {
      method: "POST",
      headers: orgAAdminHeaders,
      body: JSON.stringify({
        connectorCatalogId: s.medusaCatalogId,
        name: "Test Medusa Store",
        slug: "test-medusa-store",
        config: { baseUrl: "https://test.medusa.com" },
      }),
    });

    expect(response.status).toBe(201);
    const body = await response.json();

    expect(body.id).toBeDefined();
    expect(body.name).toBe("Test Medusa Store");
    expect(body.slug).toBe("test-medusa-store");
    expect(body.connectorCatalogId).toBe(s.medusaCatalogId);
    expect(body.isActive).toBe(true);
    expect(body.createdAt).toBeDefined();

    createdConnectorIds.push(body.id);
  });

  test("auto-creates connector_tools matching catalog tool count", async () => {
    const response = await request("/api/connectors", {
      method: "POST",
      headers: orgAAdminHeaders,
      body: JSON.stringify({
        connectorCatalogId: s.medusaCatalogId,
        name: "Tool Count Test",
        slug: "tool-count-test",
      }),
    });

    expect(response.status).toBe(201);
    const connector = await response.json();
    createdConnectorIds.push(connector.id);

    // Get the tools
    const toolsResponse = await request(
      `/api/connectors/${connector.id}/tools`,
      { headers: orgAAdminHeaders },
    );

    expect(toolsResponse.status).toBe(200);
    const toolsBody = await toolsResponse.json();

    // Medusa has 10 tools (8 storefront + 2 admin)
    expect(toolsBody.data.length).toBe(10);

    // Verify slug format
    for (const tool of toolsBody.data) {
      expect(tool.slug).toMatch(/^[a-z_]+$/);
      expect(tool.isActive).toBe(true);
    }
  });

  test("rejects duplicate slug within same org (409)", async () => {
    // Create first
    const first = await request("/api/connectors", {
      method: "POST",
      headers: orgAAdminHeaders,
      body: JSON.stringify({
        connectorCatalogId: s.medusaCatalogId,
        name: "Duplicate Test",
        slug: "duplicate-slug-test",
      }),
    });
    expect(first.status).toBe(201);
    const firstBody = await first.json();
    createdConnectorIds.push(firstBody.id);

    // Create second with same slug
    const second = await request("/api/connectors", {
      method: "POST",
      headers: orgAAdminHeaders,
      body: JSON.stringify({
        connectorCatalogId: s.medusaCatalogId,
        name: "Duplicate Test 2",
        slug: "duplicate-slug-test",
      }),
    });
    expect(second.status).toBe(409);
  });

  test("rejects non-existent catalog ID (404)", async () => {
    const fakeId = "00000000-0000-0000-0000-000000000000";
    const response = await request("/api/connectors", {
      method: "POST",
      headers: orgAAdminHeaders,
      body: JSON.stringify({
        connectorCatalogId: fakeId,
        name: "Bad Catalog",
        slug: "bad-catalog",
      }),
    });

    expect(response.status).toBe(404);
  });

  test("rejects support role (403)", async () => {
    const response = await request("/api/connectors", {
      method: "POST",
      headers: orgASupportHeaders,
      body: JSON.stringify({
        connectorCatalogId: s.medusaCatalogId,
        name: "Support Attempt",
        slug: "support-attempt",
      }),
    });

    expect(response.status).toBe(403);
  });

  test("validates required fields (422)", async () => {
    const response = await request("/api/connectors", {
      method: "POST",
      headers: orgAAdminHeaders,
      body: JSON.stringify({ name: "Missing fields" }),
    });

    expect(response.status).toBe(422);
  });

  test("rejects unauthenticated request (401)", async () => {
    const response = await request("/api/connectors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        connectorCatalogId: s.medusaCatalogId,
        name: "No Auth",
        slug: "no-auth",
      }),
    });

    expect(response.status).toBe(401);
  });
});

// ============================================================================
// GET /api/connectors - List connectors
// ============================================================================

describe("GET /api/connectors", () => {
  test("returns org connectors with pagination (200)", async () => {
    const response = await request("/api/connectors", {
      headers: orgAAdminHeaders,
    });

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.data).toBeArray();
    expect(body.data.length).toBeGreaterThanOrEqual(1);
    expect(body.pagination).toBeDefined();
    expect(body.pagination.page).toBe(1);
  });

  test("supports pagination parameters", async () => {
    const response = await request("/api/connectors?page=1&pageSize=5", {
      headers: orgAAdminHeaders,
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.pagination.pageSize).toBe(5);
  });

  test("accessible by support role (200)", async () => {
    const response = await request("/api/connectors", {
      headers: orgASupportHeaders,
    });

    expect(response.status).toBe(200);
  });
});

// ============================================================================
// GET /api/connectors/:id - Get connector
// ============================================================================

describe("GET /api/connectors/:id", () => {
  test("returns connector details (200)", async () => {
    const response = await request(
      `/api/connectors/${s.orgAMedusaConnectorId}`,
      {
        headers: orgAAdminHeaders,
      },
    );

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.id).toBe(s.orgAMedusaConnectorId);
    expect(body.name).toBeDefined();
    expect(body.slug).toBeDefined();
    expect(body.isActive).toBeDefined();
  });

  test("returns 404 for non-existent connector", async () => {
    const fakeId = "00000000-0000-0000-0000-000000000000";
    const response = await request(`/api/connectors/${fakeId}`, {
      headers: orgAAdminHeaders,
    });

    expect(response.status).toBe(404);
  });
});

// ============================================================================
// PATCH /api/connectors/:id - Update connector
// ============================================================================

describe("PATCH /api/connectors/:id", () => {
  let updateConnectorId: string;

  beforeAll(async () => {
    const response = await request("/api/connectors", {
      method: "POST",
      headers: orgAAdminHeaders,
      body: JSON.stringify({
        connectorCatalogId: s.medusaCatalogId,
        name: "Update Target",
        slug: "update-target",
      }),
    });
    const body = await response.json();
    updateConnectorId = body.id;
    createdConnectorIds.push(updateConnectorId);
  });

  test("updates name (200)", async () => {
    const response = await request(`/api/connectors/${updateConnectorId}`, {
      method: "PATCH",
      headers: orgAAdminHeaders,
      body: JSON.stringify({ name: "Updated Name" }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.name).toBe("Updated Name");
  });

  test("updates config (200)", async () => {
    const response = await request(`/api/connectors/${updateConnectorId}`, {
      method: "PATCH",
      headers: orgAAdminHeaders,
      body: JSON.stringify({ config: { baseUrl: "https://new.url" } }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.config.baseUrl).toBe("https://new.url");
  });

  test("updates isActive (200)", async () => {
    const response = await request(`/api/connectors/${updateConnectorId}`, {
      method: "PATCH",
      headers: orgAAdminHeaders,
      body: JSON.stringify({ isActive: false }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.isActive).toBe(false);
  });

  test("rejects support role (403)", async () => {
    const response = await request(`/api/connectors/${updateConnectorId}`, {
      method: "PATCH",
      headers: orgASupportHeaders,
      body: JSON.stringify({ name: "Hijacked" }),
    });

    expect(response.status).toBe(403);
  });

  test("rejects empty body (422)", async () => {
    const response = await request(`/api/connectors/${updateConnectorId}`, {
      method: "PATCH",
      headers: orgAAdminHeaders,
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(422);
  });

  test("returns 404 for non-existent connector", async () => {
    const fakeId = "00000000-0000-0000-0000-000000000000";
    const response = await request(`/api/connectors/${fakeId}`, {
      method: "PATCH",
      headers: orgAAdminHeaders,
      body: JSON.stringify({ name: "Ghost" }),
    });

    expect(response.status).toBe(404);
  });
});

// ============================================================================
// DELETE /api/connectors/:id - Delete connector
// ============================================================================

describe("DELETE /api/connectors/:id", () => {
  test("deletes connector and cascading tools (204)", async () => {
    const createResponse = await request("/api/connectors", {
      method: "POST",
      headers: orgAAdminHeaders,
      body: JSON.stringify({
        connectorCatalogId: s.medusaCatalogId,
        name: "Delete Target",
        slug: "delete-target",
      }),
    });
    const { id } = await createResponse.json();

    // Verify tools exist
    const toolsResponse = await request(`/api/connectors/${id}/tools`, {
      headers: orgAAdminHeaders,
    });
    const toolsBody = await toolsResponse.json();
    expect(toolsBody.data.length).toBeGreaterThan(0);

    // Delete
    const response = await request(`/api/connectors/${id}`, {
      method: "DELETE",
      headers: orgAAdminHeaders,
    });

    expect(response.status).toBe(204);

    // Verify it's gone
    const getResponse = await request(`/api/connectors/${id}`, {
      headers: orgAAdminHeaders,
    });
    expect(getResponse.status).toBe(404);
  });

  test("returns 404 for non-existent connector", async () => {
    const fakeId = "00000000-0000-0000-0000-000000000000";
    const response = await request(`/api/connectors/${fakeId}`, {
      method: "DELETE",
      headers: orgAAdminHeaders,
    });

    expect(response.status).toBe(404);
  });

  test("rejects support role (403)", async () => {
    const response = await request(
      `/api/connectors/${s.orgAMedusaConnectorId}`,
      {
        method: "DELETE",
        headers: orgASupportHeaders,
      },
    );

    expect(response.status).toBe(403);
  });
});

// ============================================================================
// GET /api/connectors/:id/tools - List tools
// ============================================================================

describe("GET /api/connectors/:id/tools", () => {
  test("returns tools for connector (200)", async () => {
    const response = await request(
      `/api/connectors/${s.orgAMedusaConnectorId}/tools`,
      { headers: orgAAdminHeaders },
    );

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.data).toBeArray();
    expect(body.data.length).toBeGreaterThan(0);

    const tool = body.data[0];
    expect(tool.id).toBeDefined();
    expect(tool.connectorId).toBe(s.orgAMedusaConnectorId);
    expect(tool.name).toBeDefined();
    expect(tool.slug).toBeDefined();
    expect(tool.isActive).toBeDefined();
  });

  test("returns 404 for non-existent connector", async () => {
    const fakeId = "00000000-0000-0000-0000-000000000000";
    const response = await request(`/api/connectors/${fakeId}/tools`, {
      headers: orgAAdminHeaders,
    });

    expect(response.status).toBe(404);
  });

  test("accessible by support role (200)", async () => {
    const response = await request(
      `/api/connectors/${s.orgAMedusaConnectorId}/tools`,
      { headers: orgASupportHeaders },
    );

    expect(response.status).toBe(200);
  });
});

// ============================================================================
// PATCH /api/connectors/tools/:toolId - Update tool
// ============================================================================

describe("PATCH /api/connectors/tools/:toolId", () => {
  let testToolId: string;

  beforeAll(async () => {
    // Get a tool from the orgA connector
    const response = await request(
      `/api/connectors/${s.orgAMedusaConnectorId}/tools`,
      { headers: orgAAdminHeaders },
    );
    const body = await response.json();
    testToolId = body.data[0].id;
  });

  test("updates isActive (200)", async () => {
    const response = await request(`/api/connectors/tools/${testToolId}`, {
      method: "PATCH",
      headers: orgAAdminHeaders,
      body: JSON.stringify({ isActive: false }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.isActive).toBe(false);

    // Restore
    await request(`/api/connectors/tools/${testToolId}`, {
      method: "PATCH",
      headers: orgAAdminHeaders,
      body: JSON.stringify({ isActive: true }),
    });
  });

  test("updates timeoutSeconds (200)", async () => {
    const response = await request(`/api/connectors/tools/${testToolId}`, {
      method: "PATCH",
      headers: orgAAdminHeaders,
      body: JSON.stringify({ timeoutSeconds: 60 }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.timeoutSeconds).toBe(60);
  });

  test("rejects empty body (422)", async () => {
    const response = await request(`/api/connectors/tools/${testToolId}`, {
      method: "PATCH",
      headers: orgAAdminHeaders,
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(422);
  });

  test("returns 404 for non-existent tool", async () => {
    const fakeId = "00000000-0000-0000-0000-000000000000";
    const response = await request(`/api/connectors/tools/${fakeId}`, {
      method: "PATCH",
      headers: orgAAdminHeaders,
      body: JSON.stringify({ isActive: true }),
    });

    expect(response.status).toBe(404);
  });
});

// ============================================================================
// POST /api/connectors/:id/ping - Health check
// ============================================================================

describe("POST /api/connectors/:id/ping", () => {
  const originalFetch = globalThis.fetch;

  /**
   * Mock globalThis.fetch for external connector health-check calls.
   * The Hono app uses app.fetch() (not globalThis.fetch) so this only
   * intercepts the outbound HTTP call the healthCheck function makes.
   */
  function mockExternalFetch() {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(JSON.stringify({ products: [], count: 0 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    ) as typeof fetch;
  }

  function restoreFetch() {
    globalThis.fetch = originalFetch;
  }

  test("returns 200 with health check result shape", async () => {
    mockExternalFetch();
    try {
      const response = await request(
        `/api/connectors/${s.orgAMedusaConnectorId}/ping`,
        {
          method: "POST",
          headers: orgAAdminHeaders,
        },
      );

      expect(response.status).toBe(200);
      const body = await response.json();

      expect(body.status).toBeOneOf(["healthy", "error"]);
      expect(typeof body.latencyMs).toBe("number");
      expect(body.checkedAt).toBeTruthy();
    } finally {
      restoreFetch();
    }
  });

  test("returns 404 for non-existent connector", async () => {
    const fakeId = "00000000-0000-0000-0000-000000000000";
    const response = await request(`/api/connectors/${fakeId}/ping`, {
      method: "POST",
      headers: orgAAdminHeaders,
    });

    expect(response.status).toBe(404);
  });

  test("returns 404 for cross-org connector (RLS)", async () => {
    const response = await request(
      `/api/connectors/${s.orgAMedusaConnectorId}/ping`,
      {
        method: "POST",
        headers: orgBAdminHeaders,
      },
    );

    expect(response.status).toBe(404);
  });

  test("accessible by support role", async () => {
    mockExternalFetch();
    try {
      const response = await request(
        `/api/connectors/${s.orgAMedusaConnectorId}/ping`,
        {
          method: "POST",
          headers: orgASupportHeaders,
        },
      );

      expect(response.status).toBe(200);
    } finally {
      restoreFetch();
    }
  });

  test("returns 401 for unauthenticated request", async () => {
    const response = await request(
      `/api/connectors/${s.orgAMedusaConnectorId}/ping`,
      {
        method: "POST",
      },
    );

    expect(response.status).toBe(401);
  });
});

// ============================================================================
// RLS isolation
// ============================================================================

describe("RLS isolation", () => {
  test("org B cannot see org A connectors in list", async () => {
    const response = await request("/api/connectors", {
      headers: orgBAdminHeaders,
    });

    expect(response.status).toBe(200);
    const body = await response.json();

    const ids = body.data.map((c: { id: string }) => c.id);
    expect(ids).not.toContain(s.orgAMedusaConnectorId);
  });

  test("org B cannot get org A connector by ID (404)", async () => {
    const response = await request(
      `/api/connectors/${s.orgAMedusaConnectorId}`,
      {
        headers: orgBAdminHeaders,
      },
    );

    expect(response.status).toBe(404);
  });

  test("org B cannot update org A connector (404)", async () => {
    const response = await request(
      `/api/connectors/${s.orgAMedusaConnectorId}`,
      {
        method: "PATCH",
        headers: orgBAdminHeaders,
        body: JSON.stringify({ name: "Hijacked" }),
      },
    );

    expect(response.status).toBe(404);
  });

  test("org B cannot delete org A connector (404)", async () => {
    const response = await request(
      `/api/connectors/${s.orgAMedusaConnectorId}`,
      {
        method: "DELETE",
        headers: orgBAdminHeaders,
      },
    );

    expect(response.status).toBe(404);
  });

  test("org B cannot see org A connector tools (404)", async () => {
    const response = await request(
      `/api/connectors/${s.orgAMedusaConnectorId}/tools`,
      { headers: orgBAdminHeaders },
    );

    expect(response.status).toBe(404);
  });
});

// ============================================================================
// CRUD audit — strict validation (#64)
// ============================================================================

describe("Strict PATCH schema", () => {
  test("rejects unknown fields with 422", async () => {
    const response = await request(
      `/api/connectors/${s.orgAMedusaConnectorId}`,
      {
        method: "PATCH",
        headers: orgAAdminHeaders,
        body: JSON.stringify({ name: "Valid Name", bogusField: "nope" }),
      },
    );

    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.error?.formErrors || body.error?.fieldErrors).toBeDefined();
  });
});
