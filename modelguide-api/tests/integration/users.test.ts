import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import app from "@/app";
import { forApp } from "@db/rls";
import { users } from "@db/schema";
import { and, eq, notInArray } from "drizzle-orm";
import {
  type TestSeed,
  authHeadersFor,
  getTestSeed,
} from "../helpers/seed";

let s: TestSeed;
/** IDs of users created during tests (for cleanup) */
const createdUserIds: string[] = [];

function request(path: string, options?: RequestInit) {
  return app.fetch(new Request(`http://localhost${path}`, options));
}

beforeAll(async () => {
  s = await getTestSeed();
});

afterAll(async () => {
  // Clean up test-created users only (not seed users)
  if (createdUserIds.length > 0) {
    await forApp(async (tx) => {
      for (const id of createdUserIds) {
        await tx.delete(users).where(eq(users.id, id));
      }
    });
  }
});

// ============================================================================
// GET /api/users - List users
// ============================================================================

describe("GET /api/users", () => {
  test("admin can list users", async () => {
    const headers = await authHeadersFor(s.pizzaAdmin);
    const response = await request("/api/users", { headers });
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.data).toBeArray();
    expect(body.data.length).toBeGreaterThanOrEqual(3); // admin, support, inactive
    expect(body.pagination).toBeDefined();
    expect(body.pagination.page).toBe(1);
  });

  test("support can list users", async () => {
    const headers = await authHeadersFor(s.pizzaSupport);
    const response = await request("/api/users", { headers });
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.data).toBeArray();
  });

  test("pagination works", async () => {
    const headers = await authHeadersFor(s.pizzaAdmin);
    const response = await request("/api/users?page=1&pageSize=1", { headers });
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.data.length).toBe(1);
    expect(body.pagination.pageSize).toBe(1);
    expect(body.pagination.totalItems).toBeGreaterThanOrEqual(3);
    expect(body.pagination.hasNextPage).toBe(true);
  });

  test("returns 401 without auth", async () => {
    const response = await request("/api/users");
    expect(response.status).toBe(401);
  });
});

// ============================================================================
// POST /api/users - Create user
// ============================================================================

describe("POST /api/users", () => {
  test("admin can create user", async () => {
    const headers = await authHeadersFor(s.pizzaAdmin);
    const email = `new_user_${Date.now()}@test.com`;

    const response = await request("/api/users", {
      method: "POST",
      headers,
      body: JSON.stringify({ email, name: "New User", role: "support" }),
    });
    expect(response.status).toBe(201);

    const body = await response.json();
    expect(body.email).toBe(email);
    expect(body.name).toBe("New User");
    expect(body.role).toBe("support");
    expect(body.isActive).toBe(true);
    createdUserIds.push(body.id);
  });

  test("duplicate email returns 409", async () => {
    const headers = await authHeadersFor(s.pizzaAdmin);

    const response = await request("/api/users", {
      method: "POST",
      headers,
      body: JSON.stringify({
        email: s.pizzaAdmin.email,
        name: "Duplicate",
        role: "support",
      }),
    });
    expect(response.status).toBe(409);

    const body = await response.json();
    expect(body.code).toBe("USER_EMAIL_EXISTS");
  });

  test("support cannot create user (403)", async () => {
    const headers = await authHeadersFor(s.pizzaSupport);

    const response = await request("/api/users", {
      method: "POST",
      headers,
      body: JSON.stringify({
        email: `forbidden_${Date.now()}@test.com`,
        name: "Forbidden",
        role: "support",
      }),
    });
    expect(response.status).toBe(403);
  });
});

// ============================================================================
// GET /api/users/:id - Get user detail
// ============================================================================

describe("GET /api/users/:id", () => {
  test("admin can get any user", async () => {
    const headers = await authHeadersFor(s.pizzaAdmin);
    const response = await request(`/api/users/${s.pizzaSupport.id}`, {
      headers,
    });
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.id).toBe(s.pizzaSupport.id);
  });

  test("support can get self", async () => {
    const headers = await authHeadersFor(s.pizzaSupport);
    const response = await request(`/api/users/${s.pizzaSupport.id}`, {
      headers,
    });
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.id).toBe(s.pizzaSupport.id);
  });

  test("404 for missing user", async () => {
    const headers = await authHeadersFor(s.pizzaAdmin);
    const fakeId = "00000000-0000-0000-0000-000000000000";
    const response = await request(`/api/users/${fakeId}`, { headers });
    expect(response.status).toBe(404);
  });
});

// ============================================================================
// PATCH /api/users/:id - Update user
// ============================================================================

describe("PATCH /api/users/:id", () => {
  test("admin can update user name", async () => {
    const headers = await authHeadersFor(s.pizzaAdmin);
    const response = await request(`/api/users/${s.pizzaSupport.id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ name: "Updated Support" }),
    });
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.name).toBe("Updated Support");

    // Restore original name
    await request(`/api/users/${s.pizzaSupport.id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ name: "Support User" }),
    });
  });

  test("support can update own name", async () => {
    const headers = await authHeadersFor(s.pizzaSupport);
    const response = await request(`/api/users/${s.pizzaSupport.id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ name: "My New Name" }),
    });
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.name).toBe("My New Name");

    // Restore
    await request(`/api/users/${s.pizzaSupport.id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ name: "Support User" }),
    });
  });

  test("support cannot change role", async () => {
    const headers = await authHeadersFor(s.pizzaSupport);
    const response = await request(`/api/users/${s.pizzaSupport.id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ role: "admin" }),
    });
    expect(response.status).toBe(403);
  });

  test("support cannot update other users", async () => {
    const headers = await authHeadersFor(s.pizzaSupport);
    const response = await request(`/api/users/${s.pizzaAdmin.id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ name: "Hacked" }),
    });
    expect(response.status).toBe(403);
  });
});

// ============================================================================
// DELETE /api/users/:id - Deactivate user
// ============================================================================

describe("DELETE /api/users/:id", () => {
  test("admin can deactivate user", async () => {
    // Create a user to deactivate
    const headers = await authHeadersFor(s.pizzaAdmin);
    const email = `deactivate_${Date.now()}@test.com`;

    const createResponse = await request("/api/users", {
      method: "POST",
      headers,
      body: JSON.stringify({ email, name: "To Deactivate", role: "support" }),
    });
    const created = await createResponse.json();
    createdUserIds.push(created.id);

    const response = await request(`/api/users/${created.id}`, {
      method: "DELETE",
      headers,
    });
    expect(response.status).toBe(204);

    // Verify user is deactivated
    const getResponse = await request(`/api/users/${created.id}`, { headers });
    const body = await getResponse.json();
    expect(body.isActive).toBe(false);
  });

  test("support cannot deactivate users (403)", async () => {
    const headers = await authHeadersFor(s.pizzaSupport);
    const response = await request(`/api/users/${s.pizzaAdmin.id}`, {
      method: "DELETE",
      headers,
    });
    expect(response.status).toBe(403);
  });
});

// ============================================================================
// Cross-org RLS
// ============================================================================

describe("Cross-org access blocked", () => {
  test("org B admin cannot see org A users", async () => {
    const headers = await authHeadersFor(s.burgerAdmin);
    const response = await request(`/api/users/${s.pizzaAdmin.id}`, {
      headers,
    });
    expect(response.status).toBe(404);
  });

  test("org B admin list only shows org B users", async () => {
    const headers = await authHeadersFor(s.burgerAdmin);
    const response = await request("/api/users", { headers });
    expect(response.status).toBe(200);

    const body = await response.json();
    for (const user of body.data) {
      expect(user.id).not.toBe(s.pizzaAdmin.id);
      expect(user.id).not.toBe(s.pizzaSupport.id);
    }
  });
});
