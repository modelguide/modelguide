/**
 * Integration tests for Secrets API
 * Tests the full HTTP request/response cycle with RLS isolation
 *
 * Post entity-owned-secret-refs migration:
 *   - secrets are org-scoped vault entries (no ownerType/ownerId)
 *   - optional `scope` browsing label ("connector" | "agent", nullable)
 *   - entities (connectors, agents) hold { fieldName: secretId } ref maps
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import app from "@/app";
import { forApp } from "@db/rls";
import { secrets } from "@db/schema";
import { eq } from "drizzle-orm";
import { withRLSTransaction } from "../helpers/rls";
import { type TestSeed, authHeadersFor, getTestSeed } from "../helpers/seed";

let s: TestSeed;
let orgAAdminHeaders: Record<string, string>;
let orgASupportHeaders: Record<string, string>;
let orgBAdminHeaders: Record<string, string>;

/** IDs of secrets created during tests (for cleanup) */
const createdSecretIds: string[] = [];

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
  test("creates scoped secret and returns metadata without value (201)", async () => {
    const response = await request("/api/secrets", {
      method: "POST",
      headers: orgAAdminHeaders,
      body: JSON.stringify({
        name: "Test API Key",
        value: "sk_live_test_12345",
        secretType: "api_key",
        scope: "connector",
      }),
    });

    expect(response.status).toBe(201);
    const body = await response.json();

    expect(body.id).toBeDefined();
    expect(body.name).toBe("Test API Key");
    expect(body.secretType).toBe("api_key");
    expect(body.scope).toBe("connector");
    expect(body.createdAt).toBeDefined();
    // Value must NEVER be returned
    expect(body.value).toBeUndefined();
    expect(body.encryptedValue).toBeUndefined();
    // Legacy fields must NOT be present
    expect(body.ownerType).toBeUndefined();
    expect(body.ownerId).toBeUndefined();

    createdSecretIds.push(body.id);
  });

  test("creates unscoped secret when scope is omitted (201)", async () => {
    const response = await request("/api/secrets", {
      method: "POST",
      headers: orgAAdminHeaders,
      body: JSON.stringify({
        name: "Unscoped Credential",
        value: "unscoped_value",
        secretType: "credentials",
      }),
    });

    expect(response.status).toBe(201);
    const body = await response.json();

    expect(body.id).toBeDefined();
    expect(body.scope).toBeNull();

    createdSecretIds.push(body.id);
  });

  test("stores encrypted value in DB (not plaintext)", async () => {
    const response = await request("/api/secrets", {
      method: "POST",
      headers: orgAAdminHeaders,
      body: JSON.stringify({
        name: "Encryption Check",
        value: "my_plaintext_secret",
        secretType: "credentials",
        scope: "connector",
      }),
    });

    expect(response.status).toBe(201);
    const body = await response.json();
    createdSecretIds.push(body.id);

    // Read directly from DB to verify encryption
    const [dbSecret] = await withRLSTransaction(s.orgA.id, (tx) =>
      tx.select().from(secrets).where(eq(secrets.id, body.id)),
    );

    expect(dbSecret.encryptedValue).toBeDefined();
    expect(dbSecret.encryptedValue).not.toBe("my_plaintext_secret");
    // Should be a JSON string with encrypted data
    const parsed = JSON.parse(dbSecret.encryptedValue);
    expect(parsed.encrypted).toBeDefined();
    expect(parsed.iv).toBeDefined();
  });

  test("validates required fields (422)", async () => {
    const response = await request("/api/secrets", {
      method: "POST",
      headers: orgAAdminHeaders,
      body: JSON.stringify({ name: "Missing fields" }),
    });

    expect(response.status).toBe(422);
  });

  test("rejects empty name (422)", async () => {
    const response = await request("/api/secrets", {
      method: "POST",
      headers: orgAAdminHeaders,
      body: JSON.stringify({
        name: "",
        value: "some_value",
        secretType: "api_key",
        scope: "connector",
      }),
    });

    expect(response.status).toBe(422);
  });

  test("rejects unknown fields via .strict() (422)", async () => {
    const response = await request("/api/secrets", {
      method: "POST",
      headers: orgAAdminHeaders,
      body: JSON.stringify({
        name: "Strict Test",
        value: "some_value",
        secretType: "api_key",
        ownerType: "connector",
        ownerId: "00000000-0000-0000-0000-000000000000",
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
      }),
    });

    expect(response.status).toBe(401);
  });

  test("rejects support role (403)", async () => {
    const response = await request("/api/secrets", {
      method: "POST",
      headers: orgASupportHeaders,
      body: JSON.stringify({
        name: "Support Attempt",
        value: "secret",
        secretType: "api_key",
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
      headers: orgAAdminHeaders,
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
      // scope should be present (nullable)
      expect("scope" in secret).toBe(true);
    }
  });

  test("supports pagination parameters", async () => {
    const response = await request("/api/secrets?page=1&pageSize=5", {
      headers: orgAAdminHeaders,
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.pagination.pageSize).toBe(5);
  });

  test("filters by scope", async () => {
    const response = await request("/api/secrets?scope=connector", {
      headers: orgAAdminHeaders,
    });

    expect(response.status).toBe(200);
    const body = await response.json();

    // All returned secrets should be scoped to "connector"
    for (const secret of body.data) {
      expect(secret.scope).toBe("connector");
    }
  });

  test("scope filter with includeUnscoped returns both scoped and unscoped", async () => {
    // Ensure there's an unscoped secret
    const createRes = await request("/api/secrets", {
      method: "POST",
      headers: orgAAdminHeaders,
      body: JSON.stringify({
        name: "Unscoped For Filter Test",
        value: "unscoped_filter_test",
        secretType: "api_key",
      }),
    });
    const created = await createRes.json();
    createdSecretIds.push(created.id);

    const response = await request(
      "/api/secrets?scope=connector&includeUnscoped=true",
      { headers: orgAAdminHeaders },
    );

    expect(response.status).toBe(200);
    const body = await response.json();

    const scopes = body.data.map((s: { scope: string | null }) => s.scope);
    // Should contain both connector-scoped and unscoped (null)
    expect(scopes).toContain("connector");
    expect(scopes).toContain(null);
  });

  test("rejects unauthenticated request (401)", async () => {
    const response = await request("/api/secrets");

    expect(response.status).toBe(401);
  });

  test("rejects support role (403)", async () => {
    const response = await request("/api/secrets", {
      headers: orgASupportHeaders,
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
      headers: orgAAdminHeaders,
      body: JSON.stringify({
        name: "Get Target",
        value: "get_me",
        secretType: "api_key",
        scope: "connector",
      }),
    });
    const body = await response.json();
    testSecretId = body.id;
    createdSecretIds.push(testSecretId);
  });

  test("returns secret metadata without value (200)", async () => {
    const response = await request(`/api/secrets/${testSecretId}`, {
      headers: orgAAdminHeaders,
    });

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.id).toBe(testSecretId);
    expect(body.name).toBe("Get Target");
    expect(body.secretType).toBe("api_key");
    expect(body.scope).toBe("connector");
    expect(body.createdAt).toBeDefined();
    expect(body.value).toBeUndefined();
    expect(body.encryptedValue).toBeUndefined();
  });

  test("returns 404 for non-existent secret", async () => {
    const fakeId = "00000000-0000-0000-0000-000000000000";
    const response = await request(`/api/secrets/${fakeId}`, {
      headers: orgAAdminHeaders,
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
      headers: orgASupportHeaders,
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
      headers: orgAAdminHeaders,
      body: JSON.stringify({
        name: "Update Target",
        value: "original_value",
        secretType: "api_key",
        scope: "connector",
      }),
    });
    const body = await response.json();
    updateSecretId = body.id;
    createdSecretIds.push(updateSecretId);
  });

  test("updates name only", async () => {
    const response = await request(`/api/secrets/${updateSecretId}`, {
      method: "PATCH",
      headers: orgAAdminHeaders,
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
    const [before] = await withRLSTransaction(s.orgA.id, (tx) =>
      tx.select().from(secrets).where(eq(secrets.id, updateSecretId)),
    );

    const response = await request(`/api/secrets/${updateSecretId}`, {
      method: "PATCH",
      headers: orgAAdminHeaders,
      body: JSON.stringify({ value: "new_secret_value" }),
    });

    expect(response.status).toBe(200);

    const [after] = await withRLSTransaction(s.orgA.id, (tx) =>
      tx.select().from(secrets).where(eq(secrets.id, updateSecretId)),
    );

    expect(after.encryptedValue).not.toBe(before.encryptedValue);
  });

  test("updates both name and value", async () => {
    const beforeResponse = await request(`/api/secrets/${updateSecretId}`, {
      headers: orgAAdminHeaders,
    });
    const before = await beforeResponse.json();

    const response = await request(`/api/secrets/${updateSecretId}`, {
      method: "PATCH",
      headers: orgAAdminHeaders,
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
      headers: orgAAdminHeaders,
      body: JSON.stringify({ name: "Ghost" }),
    });

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.code).toBe("NOT_FOUND");
  });

  test("validates at least one field required (422)", async () => {
    const response = await request(`/api/secrets/${updateSecretId}`, {
      method: "PATCH",
      headers: orgAAdminHeaders,
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
      headers: orgAAdminHeaders,
      body: JSON.stringify({
        name: "Delete Target",
        value: "delete_me",
        secretType: "credentials",
        scope: "connector",
      }),
    });
    const { id } = await createResponse.json();

    const response = await request(`/api/secrets/${id}`, {
      method: "DELETE",
      headers: orgAAdminHeaders,
    });

    expect(response.status).toBe(204);

    // Verify it's gone
    const result = await withRLSTransaction(s.orgA.id, (tx) =>
      tx.select().from(secrets).where(eq(secrets.id, id)),
    );
    expect(result.length).toBe(0);
  });

  test("returns 404 for non-existent secret", async () => {
    const fakeId = "00000000-0000-0000-0000-000000000000";
    const response = await request(`/api/secrets/${fakeId}`, {
      method: "DELETE",
      headers: orgAAdminHeaders,
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
  let orgASecretId: string;

  beforeAll(async () => {
    const response = await request("/api/secrets", {
      method: "POST",
      headers: orgAAdminHeaders,
      body: JSON.stringify({
        name: "Store API Key",
        value: "orgA_secret",
        secretType: "api_key",
        scope: "connector",
      }),
    });
    const body = await response.json();
    orgASecretId = body.id;
    createdSecretIds.push(orgASecretId);
  });

  test("secrets from org A not visible to org B", async () => {
    const response = await request("/api/secrets", {
      headers: orgBAdminHeaders,
    });

    expect(response.status).toBe(200);
    const body = await response.json();

    const ids = body.data.map((s: { id: string }) => s.id);
    expect(ids).not.toContain(orgASecretId);
  });

  test("org B cannot get org A secret (404 due to RLS)", async () => {
    const response = await request(`/api/secrets/${orgASecretId}`, {
      headers: orgBAdminHeaders,
    });

    expect(response.status).toBe(404);
  });

  test("org B cannot update org A secret (404 due to RLS)", async () => {
    const response = await request(`/api/secrets/${orgASecretId}`, {
      method: "PATCH",
      headers: orgBAdminHeaders,
      body: JSON.stringify({ name: "Hijacked" }),
    });

    expect(response.status).toBe(404);
  });

  test("org B cannot delete org A secret (404 due to RLS)", async () => {
    const response = await request(`/api/secrets/${orgASecretId}`, {
      method: "DELETE",
      headers: orgBAdminHeaders,
    });

    expect(response.status).toBe(404);
  });
});

// ============================================================================
// Strict PATCH schema
// ============================================================================

describe("Strict PATCH schema", () => {
  test("rejects unknown fields with 422", async () => {
    const createRes = await request("/api/secrets", {
      method: "POST",
      headers: orgAAdminHeaders,
      body: JSON.stringify({
        name: "Strict Test Secret",
        value: "test-value",
        secretType: "api_key",
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
});
