/**
 * Integration tests for Secrets API
 * Tests the full HTTP request/response cycle with RLS isolation
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import app from "@/app";
import type { AuthUser } from "@/types";
import { db } from "@db/client";
import { organizations, secrets, users } from "@db/schema";
import { generateJWT } from "@lib/jwt";
import { eq } from "drizzle-orm";
import { withRLSTransaction } from "../helpers/rls";

// Test fixtures - Org A
let orgAId: string;
let adminTokenA: string;
let supportTokenA: string;

// Test fixtures - Org B (for RLS isolation tests)
let orgBId: string;
let adminTokenB: string;

// Track created secrets for cleanup
const createdSecretIds: string[] = [];

function request(path: string, options?: RequestInit) {
  return app.fetch(new Request(`http://localhost${path}`, options));
}

function authHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

beforeAll(async () => {
  // Create Org A
  const [orgA] = await db
    .insert(organizations)
    .values({
      name: `Secrets Test Org A ${Date.now()}`,
      slug: `secrets-test-a-${Date.now()}`,
    })
    .returning();
  orgAId = orgA.id;

  // Create admin user for Org A
  const [adminA] = await withRLSTransaction(orgAId, (tx) =>
    tx
      .insert(users)
      .values({
        organizationId: orgAId,
        email: `admin_secrets_${Date.now()}@test.com`,
        name: "Admin A",
        role: "admin",
        isActive: true,
      })
      .returning(),
  );

  const adminAuthA: AuthUser = {
    id: adminA.id,
    email: adminA.email,
    name: adminA.name,
    role: "admin",
    organizationId: orgAId,
  };
  adminTokenA = await generateJWT(adminAuthA);

  // Create support user for Org A
  const [supportA] = await withRLSTransaction(orgAId, (tx) =>
    tx
      .insert(users)
      .values({
        organizationId: orgAId,
        email: `support_secrets_${Date.now()}@test.com`,
        name: "Support A",
        role: "support",
        isActive: true,
      })
      .returning(),
  );

  const supportAuthA: AuthUser = {
    id: supportA.id,
    email: supportA.email,
    name: supportA.name,
    role: "support",
    organizationId: orgAId,
  };
  supportTokenA = await generateJWT(supportAuthA);

  // Create Org B
  const [orgB] = await db
    .insert(organizations)
    .values({
      name: `Secrets Test Org B ${Date.now()}`,
      slug: `secrets-test-b-${Date.now()}`,
    })
    .returning();
  orgBId = orgB.id;

  // Create admin user for Org B
  const [adminB] = await withRLSTransaction(orgBId, (tx) =>
    tx
      .insert(users)
      .values({
        organizationId: orgBId,
        email: `admin_secrets_b_${Date.now()}@test.com`,
        name: "Admin B",
        role: "admin",
        isActive: true,
      })
      .returning(),
  );

  const adminAuthB: AuthUser = {
    id: adminB.id,
    email: adminB.email,
    name: adminB.name,
    role: "admin",
    organizationId: orgBId,
  };
  adminTokenB = await generateJWT(adminAuthB);
});

afterAll(async () => {
  // Clean up secrets (via superuser, no RLS)
  for (const id of createdSecretIds) {
    await db
      .delete(secrets)
      .where(eq(secrets.id, id))
      .catch(() => {});
  }

  // Clean up users via RLS
  await withRLSTransaction(orgAId, (tx) =>
    tx.delete(users).where(eq(users.organizationId, orgAId)),
  );
  await withRLSTransaction(orgBId, (tx) =>
    tx.delete(users).where(eq(users.organizationId, orgBId)),
  );

  // Clean up orgs
  await db.delete(organizations).where(eq(organizations.id, orgAId));
  await db.delete(organizations).where(eq(organizations.id, orgBId));
});

// ============================================================================
// POST /api/secrets - Create secret
// ============================================================================

describe("POST /api/secrets", () => {
  test("creates secret and returns metadata without value (201)", async () => {
    const response = await request("/api/secrets", {
      method: "POST",
      headers: authHeaders(adminTokenA),
      body: JSON.stringify({
        name: "Test API Key",
        value: "sk_live_test_12345",
        secretType: "api_key",
        ownerType: "connector",
        ownerId: "550e8400-e29b-41d4-a716-446655440000",
      }),
    });

    expect(response.status).toBe(201);
    const body = await response.json();

    expect(body.id).toBeDefined();
    expect(body.name).toBe("Test API Key");
    expect(body.secretType).toBe("api_key");
    expect(body.ownerType).toBe("connector");
    expect(body.ownerId).toBe("550e8400-e29b-41d4-a716-446655440000");
    expect(body.createdAt).toBeDefined();
    // Value must NEVER be returned
    expect(body.value).toBeUndefined();
    expect(body.encryptedValue).toBeUndefined();

    createdSecretIds.push(body.id);
  });

  test("stores encrypted value in DB (not plaintext)", async () => {
    const response = await request("/api/secrets", {
      method: "POST",
      headers: authHeaders(adminTokenA),
      body: JSON.stringify({
        name: "Encryption Check",
        value: "my_plaintext_secret",
        secretType: "credentials",
        ownerType: "connector",
        ownerId: "550e8400-e29b-41d4-a716-446655440001",
      }),
    });

    expect(response.status).toBe(201);
    const body = await response.json();
    createdSecretIds.push(body.id);

    // Read directly from DB (via RLS context) to verify encryption
    const [dbSecret] = await withRLSTransaction(orgAId, (tx) =>
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
      headers: authHeaders(adminTokenA),
      body: JSON.stringify({ name: "Missing fields" }),
    });

    expect(response.status).toBe(422);
  });

  test("rejects empty name (422)", async () => {
    const response = await request("/api/secrets", {
      method: "POST",
      headers: authHeaders(adminTokenA),
      body: JSON.stringify({
        name: "",
        value: "some_value",
        secretType: "api_key",
        ownerType: "connector",
        ownerId: "550e8400-e29b-41d4-a716-446655440000",
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
        ownerId: "550e8400-e29b-41d4-a716-446655440000",
      }),
    });

    expect(response.status).toBe(401);
  });

  test("rejects support role (403)", async () => {
    const response = await request("/api/secrets", {
      method: "POST",
      headers: authHeaders(supportTokenA),
      body: JSON.stringify({
        name: "Support Attempt",
        value: "secret",
        secretType: "api_key",
        ownerType: "connector",
        ownerId: "550e8400-e29b-41d4-a716-446655440000",
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
      headers: { Authorization: `Bearer ${adminTokenA}` },
    });

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.data).toBeDefined();
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.pagination).toBeDefined();
    expect(body.pagination.page).toBe(1);
    expect(body.pagination.totalItems).toBeGreaterThanOrEqual(0);

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
      headers: { Authorization: `Bearer ${adminTokenA}` },
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
      headers: { Authorization: `Bearer ${supportTokenA}` },
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
    // Create a secret to update
    const response = await request("/api/secrets", {
      method: "POST",
      headers: authHeaders(adminTokenA),
      body: JSON.stringify({
        name: "Update Target",
        value: "original_value",
        secretType: "api_key",
        ownerType: "connector",
        ownerId: "550e8400-e29b-41d4-a716-446655440000",
      }),
    });
    const body = await response.json();
    updateSecretId = body.id;
    createdSecretIds.push(updateSecretId);
  });

  test("updates name only", async () => {
    const response = await request(`/api/secrets/${updateSecretId}`, {
      method: "PATCH",
      headers: authHeaders(adminTokenA),
      body: JSON.stringify({ name: "Updated Name" }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.name).toBe("Updated Name");
    expect(body.value).toBeUndefined();
    expect(body.encryptedValue).toBeUndefined();
  });

  test("updates value only (re-encrypts)", async () => {
    // Get original encrypted value via RLS context
    const [before] = await withRLSTransaction(orgAId, (tx) =>
      tx.select().from(secrets).where(eq(secrets.id, updateSecretId)),
    );

    const response = await request(`/api/secrets/${updateSecretId}`, {
      method: "PATCH",
      headers: authHeaders(adminTokenA),
      body: JSON.stringify({ value: "new_secret_value" }),
    });

    expect(response.status).toBe(200);

    // Verify encrypted value changed in DB
    const [after] = await withRLSTransaction(orgAId, (tx) =>
      tx.select().from(secrets).where(eq(secrets.id, updateSecretId)),
    );

    expect(after.encryptedValue).not.toBe(before.encryptedValue);
  });

  test("updates both name and value", async () => {
    const response = await request(`/api/secrets/${updateSecretId}`, {
      method: "PATCH",
      headers: authHeaders(adminTokenA),
      body: JSON.stringify({ name: "Both Updated", value: "both_new_value" }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.name).toBe("Both Updated");
  });

  test("returns 404 for non-existent secret", async () => {
    const fakeId = "00000000-0000-0000-0000-000000000000";
    const response = await request(`/api/secrets/${fakeId}`, {
      method: "PATCH",
      headers: authHeaders(adminTokenA),
      body: JSON.stringify({ name: "Ghost" }),
    });

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.code).toBe("NOT_FOUND");
  });

  test("validates at least one field required (422)", async () => {
    const response = await request(`/api/secrets/${updateSecretId}`, {
      method: "PATCH",
      headers: authHeaders(adminTokenA),
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
    // Create a secret to delete
    const createResponse = await request("/api/secrets", {
      method: "POST",
      headers: authHeaders(adminTokenA),
      body: JSON.stringify({
        name: "Delete Target",
        value: "delete_me",
        secretType: "credentials",
        ownerType: "connector",
        ownerId: "550e8400-e29b-41d4-a716-446655440000",
      }),
    });
    const { id } = await createResponse.json();

    const response = await request(`/api/secrets/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${adminTokenA}` },
    });

    expect(response.status).toBe(204);

    // Verify it's gone
    const result = await withRLSTransaction(orgAId, (tx) =>
      tx.select().from(secrets).where(eq(secrets.id, id)),
    );
    expect(result.length).toBe(0);
  });

  test("returns 404 for non-existent secret", async () => {
    const fakeId = "00000000-0000-0000-0000-000000000000";
    const response = await request(`/api/secrets/${fakeId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${adminTokenA}` },
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
    // Create a secret in Org A
    const response = await request("/api/secrets", {
      method: "POST",
      headers: authHeaders(adminTokenA),
      body: JSON.stringify({
        name: "Org A Only",
        value: "org_a_secret",
        secretType: "api_key",
        ownerType: "connector",
        ownerId: "550e8400-e29b-41d4-a716-446655440000",
      }),
    });
    const body = await response.json();
    orgASecretId = body.id;
    createdSecretIds.push(orgASecretId);
  });

  test("secrets from Org A not visible to Org B", async () => {
    const response = await request("/api/secrets", {
      headers: { Authorization: `Bearer ${adminTokenB}` },
    });

    expect(response.status).toBe(200);
    const body = await response.json();

    const ids = body.data.map((s: { id: string }) => s.id);
    expect(ids).not.toContain(orgASecretId);
  });

  test("Org B cannot update Org A secret (404 due to RLS)", async () => {
    const response = await request(`/api/secrets/${orgASecretId}`, {
      method: "PATCH",
      headers: authHeaders(adminTokenB),
      body: JSON.stringify({ name: "Hijacked" }),
    });

    expect(response.status).toBe(404);
  });

  test("Org B cannot delete Org A secret (404 due to RLS)", async () => {
    const response = await request(`/api/secrets/${orgASecretId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${adminTokenB}` },
    });

    expect(response.status).toBe(404);
  });
});
