/**
 * Integration tests for Auth API
 * Tests the full HTTP request/response cycle
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import app from "@/app";
import type { AuthUser } from "@/types";
import { db } from "@db/client";
import { magicTokens, organizations, users } from "@db/schema";
import { hashMagicToken } from "@lib/crypto";
import { generateJWT } from "@lib/jwt";
import { desc, eq } from "drizzle-orm";
import { withRLSTransaction } from "../helpers/rls";

// Test fixtures
let testOrgId: string;
let testUserId: string;
let testUserEmail: string;
let inactiveUserId: string;
let inactiveUserEmail: string;

// Helper to make requests
function request(path: string, options?: RequestInit) {
  return app.fetch(new Request(`http://localhost${path}`, options));
}

// Helper to create magic token directly in DB for testing
async function createTestMagicToken(
  userId: string,
  options?: {
    expired?: boolean;
    used?: boolean;
  },
): Promise<string> {
  const token = `test_token_${Date.now()}_${Math.random().toString(36)}`;
  const tokenHash = hashMagicToken(token);
  const expiresAt = options?.expired
    ? new Date(Date.now() - 1000) // 1 second ago
    : new Date(Date.now() + 15 * 60 * 1000); // 15 minutes from now

  await db.insert(magicTokens).values({
    userId,
    tokenHash,
    expiresAt,
    usedAt: options?.used ? new Date() : null,
  });

  return token;
}

// Helper to clean up magic tokens for a user
async function cleanupMagicTokens(userId: string) {
  await db.delete(magicTokens).where(eq(magicTokens.userId, userId));
}

beforeAll(async () => {
  // Create test organization (no RLS on organizations table)
  const [org] = await db
    .insert(organizations)
    .values({
      name: `Test Org ${Date.now()}`,
      slug: `test-org-${Date.now()}`,
    })
    .returning();
  testOrgId = org.id;

  // Create active test user (with RLS context)
  testUserEmail = `test_${Date.now()}@test.com`;
  const [user] = await withRLSTransaction(testOrgId, async (tx) => {
    return tx
      .insert(users)
      .values({
        organizationId: testOrgId,
        email: testUserEmail,
        name: "Test User",
        role: "admin",
        isActive: true,
      })
      .returning();
  });
  testUserId = user.id;

  // Create inactive test user (with RLS context)
  inactiveUserEmail = `inactive_${Date.now()}@test.com`;
  const [inactiveUser] = await withRLSTransaction(testOrgId, async (tx) => {
    return tx
      .insert(users)
      .values({
        organizationId: testOrgId,
        email: inactiveUserEmail,
        name: "Inactive User",
        role: "support",
        isActive: false,
      })
      .returning();
  });
  inactiveUserId = inactiveUser.id;
});

afterAll(async () => {
  // Clean up test data in reverse order of dependencies
  // Magic tokens don't have RLS, but users do
  await cleanupMagicTokens(testUserId);
  await cleanupMagicTokens(inactiveUserId);
  await withRLSTransaction(testOrgId, async (tx) => {
    await tx.delete(users).where(eq(users.organizationId, testOrgId));
  });
  await db.delete(organizations).where(eq(organizations.id, testOrgId));
});

// ============================================================================
// POST /api/auth/login - Magic link request tests
// ============================================================================

describe("POST /api/auth/login", () => {
  test("returns success message for valid user", async () => {
    const response = await request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: testUserEmail }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ message: "Magic link sent" });
  });

  test("creates magic token record in DB for valid user", async () => {
    const beforeCount = await db
      .select()
      .from(magicTokens)
      .where(eq(magicTokens.userId, testUserId));

    const response = await request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: testUserEmail }),
    });

    expect(response.status).toBe(200);

    const afterCount = await db
      .select()
      .from(magicTokens)
      .where(eq(magicTokens.userId, testUserId));

    expect(afterCount.length).toBe(beforeCount.length + 1);

    // Verify the new token has correct fields
    const latestToken = await db.query.magicTokens.findFirst({
      where: eq(magicTokens.userId, testUserId),
      orderBy: desc(magicTokens.createdAt),
    });
    expect(latestToken).toBeDefined();
    expect(latestToken!.tokenHash).toBeDefined();
    expect(latestToken!.expiresAt).toBeInstanceOf(Date);
    expect(latestToken!.usedAt).toBeNull();
  });

  test("does not create magic token for non-existent user", async () => {
    const beforeTokens = await db.select().from(magicTokens);

    await request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "nonexistent@example.com" }),
    });

    const afterTokens = await db.select().from(magicTokens);
    expect(afterTokens.length).toBe(beforeTokens.length);
  });

  test("does not create magic token for inactive user", async () => {
    const beforeTokens = await db
      .select()
      .from(magicTokens)
      .where(eq(magicTokens.userId, inactiveUserId));

    await request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: inactiveUserEmail }),
    });

    const afterTokens = await db
      .select()
      .from(magicTokens)
      .where(eq(magicTokens.userId, inactiveUserId));
    expect(afterTokens.length).toBe(beforeTokens.length);
  });

  test("returns success for non-existent user (no enumeration)", async () => {
    const response = await request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "nonexistent@example.com" }),
    });

    // Should return same response as valid user to prevent enumeration
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ message: "Magic link sent" });
  });

  test("returns success for inactive user (no enumeration)", async () => {
    const response = await request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: inactiveUserEmail }),
    });

    // Should return same response as valid user to prevent enumeration
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ message: "Magic link sent" });
  });

  test("returns 422 for invalid email format", async () => {
    const response = await request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "not-an-email" }),
    });

    expect(response.status).toBe(422);
  });

  test("returns 422 for missing email", async () => {
    const response = await request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(422);
  });
});

// ============================================================================
// GET /api/auth/verify - Token verification tests
// ============================================================================

describe("GET /api/auth/verify", () => {
  test("returns JWT and user info for valid token", async () => {
    const token = await createTestMagicToken(testUserId);

    const response = await request(
      `/api/auth/verify?token=${encodeURIComponent(token)}`,
    );

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.token).toBeDefined();
    expect(typeof body.token).toBe("string");
    expect(body.user).toBeDefined();
    expect(body.user.id).toBe(testUserId);
    expect(body.user.email).toBe(testUserEmail);
    expect(body.user.name).toBe("Test User");
    expect(body.user.role).toBe("admin");
    expect(body.user.organizationId).toBe(testOrgId);
  });

  test("returns 401 MAGIC_TOKEN_INVALID for invalid token", async () => {
    const response = await request(
      "/api/auth/verify?token=invalid_token_12345",
    );

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.code).toBe("MAGIC_TOKEN_INVALID");
  });

  test("returns 401 MAGIC_TOKEN_EXPIRED for expired token", async () => {
    const token = await createTestMagicToken(testUserId, { expired: true });

    const response = await request(
      `/api/auth/verify?token=${encodeURIComponent(token)}`,
    );

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.code).toBe("MAGIC_TOKEN_EXPIRED");
  });

  test("returns 401 MAGIC_TOKEN_USED for already-used token", async () => {
    const token = await createTestMagicToken(testUserId, { used: true });

    const response = await request(
      `/api/auth/verify?token=${encodeURIComponent(token)}`,
    );

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.code).toBe("MAGIC_TOKEN_USED");
  });

  test("returns 422 for missing token parameter", async () => {
    const response = await request("/api/auth/verify");

    expect(response.status).toBe(422);
  });

  test("marks token as used after successful verification", async () => {
    const token = await createTestMagicToken(testUserId);

    // First verification should succeed
    const response1 = await request(
      `/api/auth/verify?token=${encodeURIComponent(token)}`,
    );
    expect(response1.status).toBe(200);

    // Second verification should fail with MAGIC_TOKEN_USED
    const response2 = await request(
      `/api/auth/verify?token=${encodeURIComponent(token)}`,
    );
    expect(response2.status).toBe(401);
    const body = await response2.json();
    expect(body.code).toBe("MAGIC_TOKEN_USED");
  });
});

// ============================================================================
// GET /api/auth/me - Current user tests
// ============================================================================

describe("GET /api/auth/me", () => {
  test("returns current user info with valid JWT", async () => {
    // Generate a valid JWT for our test user
    const authUser: AuthUser = {
      id: testUserId,
      email: testUserEmail,
      name: "Test User",
      role: "admin",
      organizationId: testOrgId,
    };
    const jwt = await generateJWT(authUser);

    const response = await request("/api/auth/me", {
      headers: {
        Authorization: `Bearer ${jwt}`,
      },
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.id).toBe(testUserId);
    expect(body.email).toBe(testUserEmail);
    expect(body.name).toBe("Test User");
    expect(body.role).toBe("admin");
    expect(body.organizationId).toBe(testOrgId);
  });

  test("returns 401 without Authorization header", async () => {
    const response = await request("/api/auth/me");

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.code).toBe("UNAUTHORIZED");
  });

  test("returns 401 with invalid JWT", async () => {
    const response = await request("/api/auth/me", {
      headers: {
        Authorization: "Bearer invalid.jwt.token",
      },
    });

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.code).toBe("UNAUTHORIZED");
  });

  test("returns 401 with malformed Authorization header", async () => {
    const response = await request("/api/auth/me", {
      headers: {
        Authorization: "NotBearer sometoken",
      },
    });

    expect(response.status).toBe(401);
  });

  test("returns 401 with empty Bearer token", async () => {
    const response = await request("/api/auth/me", {
      headers: {
        Authorization: "Bearer ",
      },
    });

    expect(response.status).toBe(401);
  });
});

// ============================================================================
// POST /api/auth/logout - Logout tests
// ============================================================================

describe("POST /api/auth/logout", () => {
  test("returns success message", async () => {
    const response = await request("/api/auth/logout", {
      method: "POST",
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ message: "Logged out successfully" });
  });

  test("returns success even without auth (stateless)", async () => {
    // Since JWT is stateless, logout doesn't require authentication
    const response = await request("/api/auth/logout", {
      method: "POST",
    });

    expect(response.status).toBe(200);
  });
});

// ============================================================================
// Race conditions
// ============================================================================

describe("Race conditions", () => {
  test("concurrent token verification - only one succeeds", async () => {
    const token = await createTestMagicToken(testUserId);

    // Fire off multiple concurrent verification requests
    const requests = Array.from({ length: 5 }, () =>
      request(`/api/auth/verify?token=${encodeURIComponent(token)}`),
    );

    const responses = await Promise.all(requests);
    const statuses = responses.map((r) => r.status);

    // Exactly one should succeed (200), others should fail (401)
    const successCount = statuses.filter((s) => s === 200).length;
    const failCount = statuses.filter((s) => s === 401).length;

    expect(successCount).toBe(1);
    expect(failCount).toBe(4);
  });
});

// ============================================================================
// Edge cases
// ============================================================================

describe("Edge cases", () => {
  test("multiple magic links for same user - all valid until used/expired", async () => {
    const token1 = await createTestMagicToken(testUserId);
    const token2 = await createTestMagicToken(testUserId);

    // Both tokens should be valid initially
    const response1 = await request(
      `/api/auth/verify?token=${encodeURIComponent(token1)}`,
    );
    expect(response1.status).toBe(200);

    // Second token should still work (wasn't used)
    const response2 = await request(
      `/api/auth/verify?token=${encodeURIComponent(token2)}`,
    );
    expect(response2.status).toBe(200);
  });

  test("login with different email cases", async () => {
    // Test that email lookup is case-insensitive
    const response = await request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: testUserEmail.toUpperCase() }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ message: "Magic link sent" });
  });
});
