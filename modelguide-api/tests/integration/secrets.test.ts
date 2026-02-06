/**
 * Integration tests for Secrets API
 * Tests the full HTTP request/response cycle with RLS isolation
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import app from "@/app";
import { forApp } from "@db/rls";
import { secrets } from "@db/schema";
import { eq } from "drizzle-orm";
import { withRLSTransaction } from "../helpers/rls";
import { type TestSeed, authHeadersFor, getTestSeed } from "../helpers/seed";

let s: TestSeed;
let pizzaAdminHeaders: Record<string, string>;
let pizzaSupportHeaders: Record<string, string>;
let burgerAdminHeaders: Record<string, string>;

/** IDs of secrets created during tests (for cleanup) */
const createdSecretIds: string[] = [];

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
  if (createdSecretIds.length > 0) {
    await forApp(async (tx) => {
      for (const id of createdSecretIds) {
        await tx.delete(secrets).where(eq(secrets.id, id));
      }
    });
  }
});

// ============================================================================
// POST /api/secrets - Create secret
// ============================================================================

describe("POST /api/secrets", () => {
  test("creates secret and returns metadata without value (201)", async () => {
    const response = await request("/api/secrets", {
      method: "POST",
      headers: pizzaAdminHeaders,
      body: JSON.stringify({
        name: "Test API Key",
        value: "sk_live_test_12345",
        secretType: "api_key",
        ownerType: "connector",
        ownerId: s.pizzaConnectorId,
      }),
    });

    expect(response.status).toBe(201);
    const body = await response.json();

    expect(body.id).toBeDefined();
    expect(body.name).toBe("Test API Key");
    expect(body.secretType).toBe("api_key");
    expect(body.ownerType).toBe("connector");
    expect(body.ownerId).toBe(s.pizzaConnectorId);
    expect(body.createdAt).toBeDefined();
    // Value must NEVER be returned
    expect(body.value).toBeUndefined();
    expect(body.encryptedValue).toBeUndefined();

    createdSecretIds.push(body.id);
  });

  test("stores encrypted value in DB (not plaintext)", async () => {
    const response = await request("/api/secrets", {
      method: "POST",
      headers: pizzaAdminHeaders,
      body: JSON.stringify({
        name: "Encryption Check",
        value: "my_plaintext_secret",
        secretType: "credentials",
        ownerType: "connector",
        ownerId: s.pizzaConnectorId,
      }),
    });

    expect(response.status).toBe(201);
    const body = await response.json();
    createdSecretIds.push(body.id);

    // Read directly from DB to verify encryption
    const [dbSecret] = await withRLSTransaction(s.pizzaOrg.id, (tx) =>
      tx.select().from(secrets).where(eq(secrets.id, body.id)),
    );

    expect(dbSecret.encryptedValue).toBeDefined();
    expect(dbSecret.encryptedValue).not.toBe("my_plaintext_secret");
    // Should be a JSON string with encrypted data
    const parsed = JSON.parse(dbSecret.encryptedValue);
    expect(parsed.encrypted).toBeDefined();
    expect(parsed.iv).toBeDefined();
  });

  test("rejects non-existent ownerId (404)", async () => {
    const fakeConnectorId = "00000000-0000-0000-0000-000000000000";
    const response = await request("/api/secrets", {
      method: "POST",
      headers: pizzaAdminHeaders,
      body: JSON.stringify({
        name: "Bad Owner",
        value: "some_value",
        secretType: "api_key",
        ownerType: "connector",
        ownerId: fakeConnectorId,
      }),
    });

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.code).toBe("NOT_FOUND");
  });

  test("validates required fields (422)", async () => {
    const response = await request("/api/secrets", {
      method: "POST",
      headers: pizzaAdminHeaders,
      body: JSON.stringify({ name: "Missing fields" }),
    });

    expect(response.status).toBe(422);
  });

  test("rejects empty name (422)", async () => {
    const response = await request("/api/secrets", {
      method: "POST",
      headers: pizzaAdminHeaders,
      body: JSON.stringify({
        name: "",
        value: "some_value",
        secretType: "api_key",
        ownerType: "connector",
        ownerId: s.pizzaConnectorId,
      }),
    });

    expect(response.status).toBe(422);
  });

  test("rejects unauthenticated request (401)", async () => {
    const response = await request("/api/secrets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "No Auth",
        value: "secret",
        secretType: "api_key",
        ownerType: "connector",
        ownerId: s.pizzaConnectorId,
      }),
    });

    expect(response.status).toBe(401);
  });

  test("rejects support role (403)", async () => {
    const response = await request("/api/secrets", {
      method: "POST",
      headers: pizzaSupportHeaders,
      body: JSON.stringify({
        name: "Support Attempt",
        value: "secret",
        secretType: "api_key",
        ownerType: "connector",
        ownerId: s.pizzaConnectorId,
      }),
    });

    expect(response.status).toBe(403);
  });
});

// ============================================================================
// GET /api/secrets - List secrets
// ============================================================================

describe("GET /api/secrets", () => {
  test("lists secrets with pagination, never returns encrypted values", async () => {
    const response = await request("/api/secrets", {
      headers: pizzaAdminHeaders,
    });

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.data).toBeArray();
    expect(body.pagination).toBeDefined();
    expect(body.pagination.page).toBe(1);
    expect(body.pagination.totalItems).toBeGreaterThanOrEqual(1);

    // Ensure no secret values are returned
    for (const secret of body.data) {
      expect(secret.value).toBeUndefined();
      expect(secret.encryptedValue).toBeUndefined();
      expect(secret.id).toBeDefined();
      expect(secret.name).toBeDefined();
      expect(secret.secretType).toBeDefined();
    }
  });

  test("supports pagination parameters", async () => {
    const response = await request("/api/secrets?page=1&pageSize=5", {
      headers: pizzaAdminHeaders,
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.pagination.pageSize).toBe(5);
  });

  test("rejects unauthenticated request (401)", async () => {
    const response = await request("/api/secrets");

    expect(response.status).toBe(401);
  });

  test("rejects support role (403)", async () => {
    const response = await request("/api/secrets", {
      headers: pizzaSupportHeaders,
    });

    expect(response.status).toBe(403);
  });
});

// ============================================================================
// GET /api/secrets/:id - Get secret
// ============================================================================

describe("GET /api/secrets/:id", () => {
  let testSecretId: string;

  beforeAll(async () => {
    const response = await request("/api/secrets", {
      method: "POST",
      headers: pizzaAdminHeaders,
      body: JSON.stringify({
        name: "Get Target",
        value: "get_me",
        secretType: "api_key",
        ownerType: "connector",
        ownerId: s.pizzaConnectorId,
      }),
    });
    const body = await response.json();
    testSecretId = body.id;
    createdSecretIds.push(testSecretId);
  });

  test("returns secret metadata without value (200)", async () => {
    const response = await request(`/api/secrets/${testSecretId}`, {
      headers: pizzaAdminHeaders,
    });

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.id).toBe(testSecretId);
    expect(body.name).toBe("Get Target");
    expect(body.secretType).toBe("api_key");
    expect(body.ownerType).toBe("connector");
    expect(body.ownerId).toBe(s.pizzaConnectorId);
    expect(body.createdAt).toBeDefined();
    expect(body.value).toBeUndefined();
    expect(body.encryptedValue).toBeUndefined();
  });

  test("returns 404 for non-existent secret", async () => {
    const fakeId = "00000000-0000-0000-0000-000000000000";
    const response = await request(`/api/secrets/${fakeId}`, {
      headers: pizzaAdminHeaders,
    });

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.code).toBe("NOT_FOUND");
  });

  test("rejects unauthenticated request (401)", async () => {
    const response = await request(`/api/secrets/${testSecretId}`);

    expect(response.status).toBe(401);
  });

  test("rejects support role (403)", async () => {
    const response = await request(`/api/secrets/${testSecretId}`, {
      headers: pizzaSupportHeaders,
    });

    expect(response.status).toBe(403);
  });
});

// ============================================================================
// PATCH /api/secrets/:id - Update secret
// ============================================================================

describe("PATCH /api/secrets/:id", () => {
  let updateSecretId: string;

  beforeAll(async () => {
    const response = await request("/api/secrets", {
      method: "POST",
      headers: pizzaAdminHeaders,
      body: JSON.stringify({
        name: "Update Target",
        value: "original_value",
        secretType: "api_key",
        ownerType: "connector",
        ownerId: s.pizzaConnectorId,
      }),
    });
    const body = await response.json();
    updateSecretId = body.id;
    createdSecretIds.push(updateSecretId);
  });

  test("updates name only", async () => {
    const response = await request(`/api/secrets/${updateSecretId}`, {
      method: "PATCH",
      headers: pizzaAdminHeaders,
      body: JSON.stringify({ name: "Updated Name" }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.name).toBe("Updated Name");
    expect(body.updatedAt).not.toBeNull();
    expect(body.value).toBeUndefined();
    expect(body.encryptedValue).toBeUndefined();
  });

  test("updates value only (re-encrypts)", async () => {
    const [before] = await withRLSTransaction(s.pizzaOrg.id, (tx) =>
      tx.select().from(secrets).where(eq(secrets.id, updateSecretId)),
    );

    const response = await request(`/api/secrets/${updateSecretId}`, {
      method: "PATCH",
      headers: pizzaAdminHeaders,
      body: JSON.stringify({ value: "new_secret_value" }),
    });

    expect(response.status).toBe(200);

    const [after] = await withRLSTransaction(s.pizzaOrg.id, (tx) =>
      tx.select().from(secrets).where(eq(secrets.id, updateSecretId)),
    );

    expect(after.encryptedValue).not.toBe(before.encryptedValue);
  });

  test("updates both name and value", async () => {
    const beforeResponse = await request(`/api/secrets/${updateSecretId}`, {
      headers: pizzaAdminHeaders,
    });
    const before = await beforeResponse.json();

    const response = await request(`/api/secrets/${updateSecretId}`, {
      method: "PATCH",
      headers: pizzaAdminHeaders,
      body: JSON.stringify({ name: "Both Updated", value: "both_new_value" }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.name).toBe("Both Updated");
    // updatedAt should change
    expect(body.updatedAt).not.toBe(before.updatedAt);
  });

  test("returns 404 for non-existent secret", async () => {
    const fakeId = "00000000-0000-0000-0000-000000000000";
    const response = await request(`/api/secrets/${fakeId}`, {
      method: "PATCH",
      headers: pizzaAdminHeaders,
      body: JSON.stringify({ name: "Ghost" }),
    });

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.code).toBe("NOT_FOUND");
  });

  test("validates at least one field required (422)", async () => {
    const response = await request(`/api/secrets/${updateSecretId}`, {
      method: "PATCH",
      headers: pizzaAdminHeaders,
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(422);
  });
});

// ============================================================================
// DELETE /api/secrets/:id - Delete secret
// ============================================================================

describe("DELETE /api/secrets/:id", () => {
  test("deletes secret (204)", async () => {
    const createResponse = await request("/api/secrets", {
      method: "POST",
      headers: pizzaAdminHeaders,
      body: JSON.stringify({
        name: "Delete Target",
        value: "delete_me",
        secretType: "credentials",
        ownerType: "connector",
        ownerId: s.pizzaConnectorId,
      }),
    });
    const { id } = await createResponse.json();

    const response = await request(`/api/secrets/${id}`, {
      method: "DELETE",
      headers: pizzaAdminHeaders,
    });

    expect(response.status).toBe(204);

    // Verify it's gone
    const result = await withRLSTransaction(s.pizzaOrg.id, (tx) =>
      tx.select().from(secrets).where(eq(secrets.id, id)),
    );
    expect(result.length).toBe(0);
  });

  test("returns 404 for non-existent secret", async () => {
    const fakeId = "00000000-0000-0000-0000-000000000000";
    const response = await request(`/api/secrets/${fakeId}`, {
      method: "DELETE",
      headers: pizzaAdminHeaders,
    });

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.code).toBe("NOT_FOUND");
  });
});

// ============================================================================
// RLS isolation
// ============================================================================

describe("RLS isolation", () => {
  let pizzaSecretId: string;

  beforeAll(async () => {
    const response = await request("/api/secrets", {
      method: "POST",
      headers: pizzaAdminHeaders,
      body: JSON.stringify({
        name: "Pizza Only",
        value: "pizza_secret",
        secretType: "api_key",
        ownerType: "connector",
        ownerId: s.pizzaConnectorId,
      }),
    });
    const body = await response.json();
    pizzaSecretId = body.id;
    createdSecretIds.push(pizzaSecretId);
  });

  test("secrets from Pizza Palace not visible to Burger Barn", async () => {
    const response = await request("/api/secrets", {
      headers: burgerAdminHeaders,
    });

    expect(response.status).toBe(200);
    const body = await response.json();

    const ids = body.data.map((s: { id: string }) => s.id);
    expect(ids).not.toContain(pizzaSecretId);
  });

  test("Burger Barn cannot get Pizza Palace secret (404 due to RLS)", async () => {
    const response = await request(`/api/secrets/${pizzaSecretId}`, {
      headers: burgerAdminHeaders,
    });

    expect(response.status).toBe(404);
  });

  test("Burger Barn cannot update Pizza Palace secret (404 due to RLS)", async () => {
    const response = await request(`/api/secrets/${pizzaSecretId}`, {
      method: "PATCH",
      headers: burgerAdminHeaders,
      body: JSON.stringify({ name: "Hijacked" }),
    });

    expect(response.status).toBe(404);
  });

  test("Burger Barn cannot delete Pizza Palace secret (404 due to RLS)", async () => {
    const response = await request(`/api/secrets/${pizzaSecretId}`, {
      method: "DELETE",
      headers: burgerAdminHeaders,
    });

    expect(response.status).toBe(404);
  });
});
