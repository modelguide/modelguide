/**
 * Integration tests for Auth API
 * Tests the full HTTP request/response cycle
 */

import { beforeAll, describe, expect, test } from "bun:test";
import app from "@/app";
import type { AuthUser } from "@/types";
import { db } from "@db/client";
import { magicTokens } from "@db/schema";
import { hashMagicToken } from "@lib/crypto";
import { generateJWT } from "@lib/jwt";
import { desc, eq } from "drizzle-orm";
import { type TestSeed, getTestSeed } from "../helpers/seed";

let s: TestSeed;

function request(path: string, options?: RequestInit) {
  return app.fetch(new Request(`http://localhost${path}`, options));
}

async function createTestMagicToken(
  userId: string,
  options?: { expired?: boolean; used?: boolean },
): Promise<string> {
  const token = `test_token_${Date.now()}_${Math.random().toString(36)}`;
  const tokenHash = hashMagicToken(token);
  const expiresAt = options?.expired
    ? new Date(Date.now() - 1000)
    : new Date(Date.now() + 15 * 60 * 1000);

  await db.insert(magicTokens).values({
    userId,
    tokenHash,
    expiresAt,
    usedAt: options?.used ? new Date() : null,
  });

  return token;
}

beforeAll(async () => {
  s = await getTestSeed();
});

// ============================================================================
// POST /api/auth/login - Magic link request tests
// ============================================================================

describe("POST /api/auth/login", () => {
  test("returns success message for valid user", async () => {
    const response = await request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: s.pizzaAdmin.email }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ message: "Magic link sent" });
  });

  test("creates magic token record in DB for valid user", async () => {
    const beforeCount = await db
      .select()
      .from(magicTokens)
      .where(eq(magicTokens.userId, s.pizzaAdmin.id));

    const response = await request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: s.pizzaAdmin.email }),
    });

    expect(response.status).toBe(200);

    const afterCount = await db
      .select()
      .from(magicTokens)
      .where(eq(magicTokens.userId, s.pizzaAdmin.id));

    expect(afterCount.length).toBe(beforeCount.length + 1);

    const latestToken = await db.query.magicTokens.findFirst({
      where: eq(magicTokens.userId, s.pizzaAdmin.id),
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
      .where(eq(magicTokens.userId, s.pizzaInactive.id));

    await request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: s.pizzaInactive.email }),
    });

    const afterTokens = await db
      .select()
      .from(magicTokens)
      .where(eq(magicTokens.userId, s.pizzaInactive.id));
    expect(afterTokens.length).toBe(beforeTokens.length);
  });

  test("returns success for non-existent user (no enumeration)", async () => {
    const response = await request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "nonexistent@example.com" }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ message: "Magic link sent" });
  });

  test("returns success for inactive user (no enumeration)", async () => {
    const response = await request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: s.pizzaInactive.email }),
    });

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
    const token = await createTestMagicToken(s.pizzaAdmin.id);

    const response = await request(
      `/api/auth/verify?token=${encodeURIComponent(token)}`,
    );

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.token).toBeDefined();
    expect(typeof body.token).toBe("string");
    expect(body.user).toBeDefined();
    expect(body.user.id).toBe(s.pizzaAdmin.id);
    expect(body.user.email).toBe(s.pizzaAdmin.email);
    expect(body.user.name).toBe(s.pizzaAdmin.name);
    expect(body.user.role).toBe("admin");
    expect(body.user.organizationId).toBe(s.pizzaOrg.id);
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
    const token = await createTestMagicToken(s.pizzaAdmin.id, {
      expired: true,
    });

    const response = await request(
      `/api/auth/verify?token=${encodeURIComponent(token)}`,
    );

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.code).toBe("MAGIC_TOKEN_EXPIRED");
  });

  test("returns 401 MAGIC_TOKEN_USED for already-used token", async () => {
    const token = await createTestMagicToken(s.pizzaAdmin.id, { used: true });

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
    const token = await createTestMagicToken(s.pizzaAdmin.id);

    const response1 = await request(
      `/api/auth/verify?token=${encodeURIComponent(token)}`,
    );
    expect(response1.status).toBe(200);

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
    const authUser: AuthUser = {
      id: s.pizzaAdmin.id,
      email: s.pizzaAdmin.email,
      name: s.pizzaAdmin.name,
      role: "admin",
      organizationId: s.pizzaOrg.id,
    };
    const jwt = await generateJWT(authUser);

    const response = await request("/api/auth/me", {
      headers: { Authorization: `Bearer ${jwt}` },
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.id).toBe(s.pizzaAdmin.id);
    expect(body.email).toBe(s.pizzaAdmin.email);
    expect(body.name).toBe(s.pizzaAdmin.name);
    expect(body.role).toBe("admin");
    expect(body.organizationId).toBe(s.pizzaOrg.id);
  });

  test("returns 401 without Authorization header", async () => {
    const response = await request("/api/auth/me");

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.code).toBe("UNAUTHORIZED");
  });

  test("returns 401 with invalid JWT", async () => {
    const response = await request("/api/auth/me", {
      headers: { Authorization: "Bearer invalid.jwt.token" },
    });

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.code).toBe("UNAUTHORIZED");
  });

  test("returns 401 with malformed Authorization header", async () => {
    const response = await request("/api/auth/me", {
      headers: { Authorization: "NotBearer sometoken" },
    });

    expect(response.status).toBe(401);
  });

  test("returns 401 with empty Bearer token", async () => {
    const response = await request("/api/auth/me", {
      headers: { Authorization: "Bearer " },
    });

    expect(response.status).toBe(401);
  });
});

// ============================================================================
// POST /api/auth/logout - Logout tests
// ============================================================================

describe("POST /api/auth/logout", () => {
  test("returns success message", async () => {
    const response = await request("/api/auth/logout", { method: "POST" });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ message: "Logged out successfully" });
  });

  test("returns success even without auth (stateless)", async () => {
    const response = await request("/api/auth/logout", { method: "POST" });
    expect(response.status).toBe(200);
  });
});

// ============================================================================
// Race conditions
// ============================================================================

describe("Race conditions", () => {
  test("concurrent token verification - only one succeeds", async () => {
    const token = await createTestMagicToken(s.pizzaAdmin.id);

    const requests = Array.from({ length: 5 }, () =>
      request(`/api/auth/verify?token=${encodeURIComponent(token)}`),
    );

    const responses = await Promise.all(requests);
    const statuses = responses.map((r) => r.status);

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
    const token1 = await createTestMagicToken(s.pizzaAdmin.id);
    const token2 = await createTestMagicToken(s.pizzaAdmin.id);

    const response1 = await request(
      `/api/auth/verify?token=${encodeURIComponent(token1)}`,
    );
    expect(response1.status).toBe(200);

    const response2 = await request(
      `/api/auth/verify?token=${encodeURIComponent(token2)}`,
    );
    expect(response2.status).toBe(200);
  });

  test("login with different email cases", async () => {
    const response = await request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: s.pizzaAdmin.email.toUpperCase() }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ message: "Magic link sent" });
  });
});
