/**
 * Integration tests for CRUD Audit — issue #64
 *
 * Tests strict PATCH schema enforcement (422 on unknown fields),
 * agent slug uniqueness (409), connector config validation (400),
 * DELETE 204 regression, and 404 on non-existent resources.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import app from "@/app";
import { forApp } from "@db/rls";
import { agents, connectors, secrets, sessions, sops } from "@db/schema";
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

const createdAgentIds: string[] = [];
const createdConnectorIds: string[] = [];
const createdSecretIds: string[] = [];
const createdSopIds: string[] = [];
const createdSessionIds: string[] = [];

function request(path: string, options?: RequestInit) {
  return app.fetch(new Request(`http://localhost${path}`, options));
}

beforeAll(async () => {
  s = await getTestSeed();
  [orgAAdminHeaders, orgAAgentHeaders] = await Promise.all([
    authHeadersFor(s.orgAAdmin),
    agentHeadersFor(s.orgAAgentId, s.orgA.id),
  ]);
});

afterAll(async () => {
  await forApp(async (tx) => {
    if (createdSessionIds.length > 0) {
      for (const id of createdSessionIds) {
        await tx.delete(sessions).where(eq(sessions.id, id));
      }
    }
    if (createdSopIds.length > 0) {
      for (const id of createdSopIds) {
        await tx.delete(sops).where(eq(sops.id, id));
      }
    }
    if (createdSecretIds.length > 0) {
      for (const id of createdSecretIds) {
        await tx.delete(secrets).where(eq(secrets.id, id));
      }
    }
    if (createdConnectorIds.length > 0) {
      for (const id of createdConnectorIds) {
        await tx.delete(connectors).where(eq(connectors.id, id));
      }
    }
    if (createdAgentIds.length > 0) {
      for (const id of createdAgentIds) {
        await tx.delete(agents).where(eq(agents.id, id));
      }
    }
  });
});

// ============================================================================
// AC #1: PATCH with unknown fields returns 422 with unrecognized_keys
// ============================================================================

describe("Strict PATCH schemas — unknown fields return 422", () => {
  test("PATCH /api/agents/:id rejects unknown fields (422)", async () => {
    const response = await request(`/api/agents/${s.orgAAgentId}`, {
      method: "PATCH",
      headers: orgAAdminHeaders,
      body: JSON.stringify({ name: "Valid Name", bogusField: "nope" }),
    });

    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.error?.formErrors || body.error?.fieldErrors).toBeDefined();
  });

  test("PATCH /api/connectors/:id rejects unknown fields (422)", async () => {
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

  test("PATCH /api/secrets/:id rejects unknown fields (422)", async () => {
    // First create a secret we can try to update
    const createRes = await request("/api/secrets", {
      method: "POST",
      headers: orgAAdminHeaders,
      body: JSON.stringify({
        name: "Strict Test Secret",
        value: "test-value",
        secretType: "api_key",
        ownerType: "connector",
        ownerId: s.orgAMedusaConnectorId,
      }),
    });
    const secret = await createRes.json();
    createdSecretIds.push(secret.id);

    const response = await request(`/api/secrets/${secret.id}`, {
      method: "PATCH",
      headers: orgAAdminHeaders,
      body: JSON.stringify({ name: "Updated", unknownProp: true }),
    });

    expect(response.status).toBe(422);
  });

  test("PATCH /api/sessions/:id rejects unknown fields (422)", async () => {
    // Create a session first
    const sessionRes = await request("/api/sessions", {
      method: "POST",
      headers: orgAAgentHeaders,
      body: JSON.stringify({
        channelType: "voice",
        userIdentifier: "+1999888777",
      }),
    });
    const session = await sessionRes.json();
    createdSessionIds.push(session.id);

    const response = await request(`/api/sessions/${session.id}`, {
      method: "PATCH",
      headers: orgAAgentHeaders,
      body: JSON.stringify({ status: "completed", extraField: "bad" }),
    });

    expect(response.status).toBe(422);
  });

  test("PATCH /api/sops/:id rejects unknown fields (422)", async () => {
    // Create a SOP first
    const createRes = await request("/api/sops", {
      method: "POST",
      headers: orgAAdminHeaders,
      body: JSON.stringify({
        name: "Strict Test SOP",
        slug: "strict-test-sop",
        definition: {
          schemaVersion: 1,
          trigger: { type: "manual", config: {} },
          steps: [
            {
              id: "step-1",
              order: 1,
              instruction: "Do something",
              required: true,
            },
          ],
          metadata: {},
        },
      }),
    });
    const sop = await createRes.json();
    createdSopIds.push(sop.id);

    const response = await request(`/api/sops/${sop.id}`, {
      method: "PATCH",
      headers: orgAAdminHeaders,
      body: JSON.stringify({ name: "Updated", phantom: "field" }),
    });

    expect(response.status).toBe(422);
  });

  test("PATCH feedback rejects unknown fields (422)", async () => {
    // Create a session and feedback entry first
    const sessionRes = await request("/api/sessions", {
      method: "POST",
      headers: orgAAgentHeaders,
      body: JSON.stringify({
        channelType: "web",
        userIdentifier: "strict-feedback@test.com",
      }),
    });
    const session = await sessionRes.json();
    createdSessionIds.push(session.id);

    const fbRes = await request(`/api/sessions/${session.id}/feedback`, {
      method: "POST",
      headers: orgAAdminHeaders,
      body: JSON.stringify({
        rating: 2,
        feedbackSource: "support",
      }),
    });
    const fb = await fbRes.json();

    const response = await request(
      `/api/sessions/${session.id}/feedback/${fb.id}`,
      {
        method: "PATCH",
        headers: orgAAdminHeaders,
        body: JSON.stringify({ rating: 1, invisible: "ghost" }),
      },
    );

    expect(response.status).toBe(422);
  });
});

// ============================================================================
// AC #2: Agent slug uniqueness — duplicate slug returns 409
// ============================================================================

describe("Agent slug uniqueness", () => {
  test("creating agent with duplicate slug returns 409 ALREADY_EXISTS", async () => {
    // First create
    const res1 = await request("/api/agents", {
      method: "POST",
      headers: orgAAdminHeaders,
      body: JSON.stringify({ name: "Slug Collision Agent" }),
    });
    expect(res1.status).toBe(201);
    const agent1 = await res1.json();
    createdAgentIds.push(agent1.id);

    // Second create with same name (same auto-generated slug)
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

// ============================================================================
// AC #3 & #4: Connector config validation on update
// ============================================================================

describe("Connector config validation on update", () => {
  let configTestConnectorId: string;

  beforeAll(async () => {
    // Create a dedicated connector for config validation tests
    const createRes = await request("/api/connectors", {
      method: "POST",
      headers: orgAAdminHeaders,
      body: JSON.stringify({
        connectorCatalogId: s.medusaCatalogId,
        name: "Config Secret Ref Test Connector",
        slug: "config-secret-ref-test",
      }),
    });
    const created = await createRes.json();
    configTestConnectorId = created.id;
    createdConnectorIds.push(created.id);
  });

  test("update with non-existent secret ref returns 400 VALIDATION_ERROR", async () => {
    const fakeSecretId = "00000000-0000-0000-0000-000000000099";

    const response = await request(`/api/connectors/${configTestConnectorId}`, {
      method: "PATCH",
      headers: orgAAdminHeaders,
      body: JSON.stringify({
        config: {
          baseUrl: "https://example.com",
          apiKey: fakeSecretId,
        },
      }),
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("VALIDATION_ERROR");
  });

  test("update with valid config (no secret refs) succeeds (200)", async () => {
    const response = await request(`/api/connectors/${configTestConnectorId}`, {
      method: "PATCH",
      headers: orgAAdminHeaders,
      body: JSON.stringify({
        config: {
          baseUrl: "https://medusa.example.com",
        },
      }),
    });

    expect(response.status).toBe(200);
  });
});

// ============================================================================
// AC #5: DELETE endpoints return 204 (regression)
// ============================================================================

describe("DELETE returns 204", () => {
  test("DELETE /api/agents/:id returns 204", async () => {
    const createRes = await request("/api/agents", {
      method: "POST",
      headers: orgAAdminHeaders,
      body: JSON.stringify({ name: "Delete 204 Test Agent" }),
    });
    const { id } = await createRes.json();

    const response = await request(`/api/agents/${id}`, {
      method: "DELETE",
      headers: orgAAdminHeaders,
    });

    expect(response.status).toBe(204);
  });

  test("DELETE /api/connectors/:id returns 204", async () => {
    // Create a connector to delete
    const createRes = await request("/api/connectors", {
      method: "POST",
      headers: orgAAdminHeaders,
      body: JSON.stringify({
        connectorCatalogId: s.medusaCatalogId,
        name: "Delete 204 Test Connector",
        slug: "delete-204-test-connector",
      }),
    });
    const { id } = await createRes.json();

    const response = await request(`/api/connectors/${id}`, {
      method: "DELETE",
      headers: orgAAdminHeaders,
    });

    expect(response.status).toBe(204);
  });

  test("DELETE /api/secrets/:id returns 204", async () => {
    const createRes = await request("/api/secrets", {
      method: "POST",
      headers: orgAAdminHeaders,
      body: JSON.stringify({
        name: "Delete 204 Test Secret",
        value: "test-secret-val",
        secretType: "api_key",
        ownerType: "connector",
        ownerId: s.orgAMedusaConnectorId,
      }),
    });
    const { id } = await createRes.json();

    const response = await request(`/api/secrets/${id}`, {
      method: "DELETE",
      headers: orgAAdminHeaders,
    });

    expect(response.status).toBe(204);
  });

  test("DELETE /api/sops/:id returns 204", async () => {
    const createRes = await request("/api/sops", {
      method: "POST",
      headers: orgAAdminHeaders,
      body: JSON.stringify({
        name: "Delete 204 Test SOP",
        slug: "delete-204-test-sop",
        definition: {
          schemaVersion: 1,
          trigger: { type: "manual", config: {} },
          steps: [
            {
              id: "step-1",
              order: 1,
              instruction: "Do something",
              required: true,
            },
          ],
          metadata: {},
        },
      }),
    });
    const { id } = await createRes.json();

    const response = await request(`/api/sops/${id}`, {
      method: "DELETE",
      headers: orgAAdminHeaders,
    });

    expect(response.status).toBe(204);
  });
});

// ============================================================================
// AC #6: Operations on non-existent resources return 404 (regression)
// ============================================================================

describe("Operations on non-existent resources return 404", () => {
  const fakeId = "00000000-0000-0000-0000-000000000000";

  test("GET /api/agents/:id returns 404", async () => {
    const response = await request(`/api/agents/${fakeId}`, {
      headers: orgAAdminHeaders,
    });
    expect(response.status).toBe(404);
  });

  test("PATCH /api/agents/:id returns 404", async () => {
    const response = await request(`/api/agents/${fakeId}`, {
      method: "PATCH",
      headers: orgAAdminHeaders,
      body: JSON.stringify({ name: "Ghost" }),
    });
    expect(response.status).toBe(404);
  });

  test("DELETE /api/agents/:id returns 404", async () => {
    const response = await request(`/api/agents/${fakeId}`, {
      method: "DELETE",
      headers: orgAAdminHeaders,
    });
    expect(response.status).toBe(404);
  });

  test("GET /api/connectors/:id returns 404", async () => {
    const response = await request(`/api/connectors/${fakeId}`, {
      headers: orgAAdminHeaders,
    });
    expect(response.status).toBe(404);
  });

  test("PATCH /api/connectors/:id returns 404", async () => {
    const response = await request(`/api/connectors/${fakeId}`, {
      method: "PATCH",
      headers: orgAAdminHeaders,
      body: JSON.stringify({ name: "Ghost" }),
    });
    expect(response.status).toBe(404);
  });

  test("DELETE /api/connectors/:id returns 404", async () => {
    const response = await request(`/api/connectors/${fakeId}`, {
      method: "DELETE",
      headers: orgAAdminHeaders,
    });
    expect(response.status).toBe(404);
  });

  test("GET /api/secrets/:id returns 404", async () => {
    const response = await request(`/api/secrets/${fakeId}`, {
      headers: orgAAdminHeaders,
    });
    expect(response.status).toBe(404);
  });

  test("PATCH /api/secrets/:id returns 404", async () => {
    const response = await request(`/api/secrets/${fakeId}`, {
      method: "PATCH",
      headers: orgAAdminHeaders,
      body: JSON.stringify({ name: "Ghost" }),
    });
    expect(response.status).toBe(404);
  });

  test("DELETE /api/secrets/:id returns 404", async () => {
    const response = await request(`/api/secrets/${fakeId}`, {
      method: "DELETE",
      headers: orgAAdminHeaders,
    });
    expect(response.status).toBe(404);
  });

  test("GET /api/sops/:id returns 404", async () => {
    const response = await request(`/api/sops/${fakeId}`, {
      headers: orgAAdminHeaders,
    });
    expect(response.status).toBe(404);
  });

  test("PATCH /api/sops/:id returns 404", async () => {
    const response = await request(`/api/sops/${fakeId}`, {
      method: "PATCH",
      headers: orgAAdminHeaders,
      body: JSON.stringify({ name: "Ghost" }),
    });
    expect(response.status).toBe(404);
  });

  test("DELETE /api/sops/:id returns 404", async () => {
    const response = await request(`/api/sops/${fakeId}`, {
      method: "DELETE",
      headers: orgAAdminHeaders,
    });
    expect(response.status).toBe(404);
  });
});
