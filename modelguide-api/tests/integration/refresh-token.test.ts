/**
 * Integration tests for refresh token rotation.
 *
 * Covers the test plan items:
 * - Magic link flow → access token + refresh cookie set
 * - 401 → refresh → retry succeeds
 * - Logout clears cookie and revokes session
 * - CSRF rejection from different/missing origin
 * - Token reuse detection
 */

import { beforeAll, describe, expect, test } from "bun:test";
import app from "@/app";
import { db } from "@db/client";
import { magicTokens, securityTokens } from "@db/schema";
import { hashMagicToken } from "@lib/crypto";
import { verifyJWT, verifyRefreshJWT } from "@lib/jwt";
import { eq } from "drizzle-orm";
import { type TestSeed, getTestSeed } from "../helpers/seed";

let s: TestSeed;

const ORIGIN = "http://localhost:3000";

function request(path: string, options?: RequestInit) {
  return app.fetch(new Request(`http://localhost${path}`, options));
}

async function createTestMagicToken(userId: string): Promise<string> {
  const token = `test_refresh_${Date.now()}_${Math.random().toString(36)}`;
  const tokenHash = hashMagicToken(token);
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

  await db.insert(magicTokens).values({
    userId,
    tokenHash,
    expiresAt,
  });

  return token;
}

/** Extract Set-Cookie value for the refresh token cookie (name varies by protocol). */
const REFRESH_COOKIE_NAME =
  new URL(ORIGIN).protocol === "https:"
    ? "__Host-refresh_token"
    : "refresh_token";

function extractRefreshCookie(response: Response): string | null {
  const cookies = response.headers.getAll("set-cookie");
  for (const cookie of cookies) {
    if (cookie.startsWith(`${REFRESH_COOKIE_NAME}=`)) {
      const value = cookie.split("=")[1].split(";")[0];
      return value;
    }
  }
  return null;
}

beforeAll(async () => {
  s = await getTestSeed();
});

// ============================================================================
// Magic link flow → access token + refresh cookie
// ============================================================================

describe("Magic link flow with refresh token", () => {
  test("verify sets access token in body and refresh cookie in Set-Cookie", async () => {
    const token = await createTestMagicToken(s.orgAAdmin.id);

    const response = await request(
      `/api/auth/verify?token=${encodeURIComponent(token)}`,
    );

    expect(response.status).toBe(200);

    // Body contains access token + user
    const body = await response.json();
    expect(body.token).toBeDefined();
    expect(typeof body.token).toBe("string");
    expect(body.user.id).toBe(s.orgAAdmin.id);

    // Access token has type: "access"
    const accessPayload = await verifyJWT(body.token);
    expect(accessPayload).not.toBeNull();
    expect(accessPayload!.id).toBe(s.orgAAdmin.id);

    // Refresh cookie is set
    const refreshValue = extractRefreshCookie(response);
    expect(refreshValue).not.toBeNull();

    // Refresh token is valid and has correct claims
    const refreshPayload = await verifyRefreshJWT(refreshValue!);
    expect(refreshPayload).not.toBeNull();
    expect(refreshPayload!.userId).toBe(s.orgAAdmin.id);
    expect(refreshPayload!.generation).toBe(0);
  });

  test("verify creates a security_tokens session in the DB", async () => {
    const token = await createTestMagicToken(s.orgAAdmin.id);

    const response = await request(
      `/api/auth/verify?token=${encodeURIComponent(token)}`,
    );
    expect(response.status).toBe(200);

    const refreshValue = extractRefreshCookie(response)!;
    const refreshPayload = await verifyRefreshJWT(refreshValue);

    const session = await db.query.securityTokens.findFirst({
      where: eq(securityTokens.familyId, refreshPayload!.familyId),
    });

    expect(session).toBeDefined();
    expect(session!.userId).toBe(s.orgAAdmin.id);
    expect(session!.generation).toBe(0);
    expect(session!.isRevoked).toBe(false);
    expect(session!.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });
});

// ============================================================================
// Refresh token rotation
// ============================================================================

describe("POST /api/auth/refresh", () => {
  test("rotates refresh token and returns new access token", async () => {
    // 1. Login to get initial tokens
    const token = await createTestMagicToken(s.orgAAdmin.id);
    const verifyRes = await request(
      `/api/auth/verify?token=${encodeURIComponent(token)}`,
    );
    const initialRefresh = extractRefreshCookie(verifyRes)!;

    // 2. Refresh
    const refreshRes = await request("/api/auth/refresh", {
      method: "POST",
      headers: {
        Origin: ORIGIN,
        Cookie: `${REFRESH_COOKIE_NAME}=${initialRefresh}`,
      },
    });

    expect(refreshRes.status).toBe(200);

    const body = await refreshRes.json();
    expect(body.token).toBeDefined();
    expect(body.user.id).toBe(s.orgAAdmin.id);

    // New refresh cookie with bumped generation
    const newRefreshValue = extractRefreshCookie(refreshRes)!;
    expect(newRefreshValue).not.toBeNull();

    const newPayload = await verifyRefreshJWT(newRefreshValue);
    expect(newPayload!.generation).toBe(1);
  });

  test("new access token is valid for authenticated endpoints", async () => {
    // 1. Login
    const token = await createTestMagicToken(s.orgAAdmin.id);
    const verifyRes = await request(
      `/api/auth/verify?token=${encodeURIComponent(token)}`,
    );
    const initialRefresh = extractRefreshCookie(verifyRes)!;

    // 2. Refresh to get new access token
    const refreshRes = await request("/api/auth/refresh", {
      method: "POST",
      headers: {
        Origin: ORIGIN,
        Cookie: `${REFRESH_COOKIE_NAME}=${initialRefresh}`,
      },
    });
    const { token: newAccessToken } = await refreshRes.json();

    // 3. Use new access token on /auth/me
    const meRes = await request("/api/auth/me", {
      headers: { Authorization: `Bearer ${newAccessToken}` },
    });

    expect(meRes.status).toBe(200);
    const me = await meRes.json();
    expect(me.id).toBe(s.orgAAdmin.id);
  });

  test("old refresh token is rejected after rotation (reuse detection)", async () => {
    // 1. Login
    const token = await createTestMagicToken(s.orgAAdmin.id);
    const verifyRes = await request(
      `/api/auth/verify?token=${encodeURIComponent(token)}`,
    );
    const gen0Refresh = extractRefreshCookie(verifyRes)!;

    // 2. Rotate once (gen 0 → gen 1)
    const refresh1Res = await request("/api/auth/refresh", {
      method: "POST",
      headers: {
        Origin: ORIGIN,
        Cookie: `${REFRESH_COOKIE_NAME}=${gen0Refresh}`,
      },
    });
    expect(refresh1Res.status).toBe(200);
    const gen1Refresh = extractRefreshCookie(refresh1Res)!;

    // 3. Rotate again (gen 1 → gen 2)
    const refresh2Res = await request("/api/auth/refresh", {
      method: "POST",
      headers: {
        Origin: ORIGIN,
        Cookie: `${REFRESH_COOKIE_NAME}=${gen1Refresh}`,
      },
    });
    expect(refresh2Res.status).toBe(200);

    // 4. Replay gen 0 token — should be detected as reuse (gap > 1)
    const reuseRes = await request("/api/auth/refresh", {
      method: "POST",
      headers: {
        Origin: ORIGIN,
        Cookie: `${REFRESH_COOKIE_NAME}=${gen0Refresh}`,
      },
    });
    expect(reuseRes.status).toBe(401);
    const reuseBody = await reuseRes.json();
    expect(reuseBody.code).toBe("REFRESH_TOKEN_REUSED");

    // 5. Session should be revoked — even the latest token fails
    const gen2Refresh = extractRefreshCookie(refresh2Res)!;
    const afterRevokeRes = await request("/api/auth/refresh", {
      method: "POST",
      headers: {
        Origin: ORIGIN,
        Cookie: `${REFRESH_COOKIE_NAME}=${gen2Refresh}`,
      },
    });
    expect(afterRevokeRes.status).toBe(401);
  });

  test("returns 401 without refresh cookie", async () => {
    const res = await request("/api/auth/refresh", {
      method: "POST",
      headers: { Origin: ORIGIN },
    });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.code).toBe("REFRESH_TOKEN_INVALID");
  });
});

// ============================================================================
// Logout — clears cookie and revokes session
// ============================================================================

describe("Logout revokes session", () => {
  test("clears refresh cookie and revokes DB session", async () => {
    // 1. Login
    const token = await createTestMagicToken(s.orgAAdmin.id);
    const verifyRes = await request(
      `/api/auth/verify?token=${encodeURIComponent(token)}`,
    );
    const refreshValue = extractRefreshCookie(verifyRes)!;
    const refreshPayload = (await verifyRefreshJWT(refreshValue))!;

    // 2. Logout
    const logoutRes = await request("/api/auth/logout", {
      method: "POST",
      headers: {
        Origin: ORIGIN,
        Cookie: `${REFRESH_COOKIE_NAME}=${refreshValue}`,
      },
    });

    expect(logoutRes.status).toBe(200);
    const body = await logoutRes.json();
    expect(body.message).toBe("Logged out successfully");

    // Cookie should be cleared (set to empty / expired)
    const cookies = logoutRes.headers.getAll("set-cookie");
    const refreshCookieHeader = cookies.find((c) =>
      c.startsWith(`${REFRESH_COOKIE_NAME}=`),
    );
    expect(refreshCookieHeader).toBeDefined();

    // 3. DB session should be revoked
    const session = await db.query.securityTokens.findFirst({
      where: eq(securityTokens.familyId, refreshPayload.familyId),
    });
    expect(session!.isRevoked).toBe(true);

    // 4. Trying to refresh with the old token should fail
    const refreshRes = await request("/api/auth/refresh", {
      method: "POST",
      headers: {
        Origin: ORIGIN,
        Cookie: `${REFRESH_COOKIE_NAME}=${refreshValue}`,
      },
    });
    expect(refreshRes.status).toBe(401);
  });
});

// ============================================================================
// CSRF protection
// ============================================================================

describe("CSRF protection", () => {
  test("refresh rejected without Origin header", async () => {
    const token = await createTestMagicToken(s.orgAAdmin.id);
    const verifyRes = await request(
      `/api/auth/verify?token=${encodeURIComponent(token)}`,
    );
    const refreshValue = extractRefreshCookie(verifyRes)!;

    const res = await request("/api/auth/refresh", {
      method: "POST",
      headers: { Cookie: `${REFRESH_COOKIE_NAME}=${refreshValue}` },
    });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe("CSRF_REJECTED");
  });

  test("refresh rejected with wrong Origin", async () => {
    const token = await createTestMagicToken(s.orgAAdmin.id);
    const verifyRes = await request(
      `/api/auth/verify?token=${encodeURIComponent(token)}`,
    );
    const refreshValue = extractRefreshCookie(verifyRes)!;

    const res = await request("/api/auth/refresh", {
      method: "POST",
      headers: {
        Origin: "https://evil.com",
        Cookie: `${REFRESH_COOKIE_NAME}=${refreshValue}`,
      },
    });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe("CSRF_REJECTED");
  });

  test("logout rejected without Origin header", async () => {
    const res = await request("/api/auth/logout", { method: "POST" });
    expect(res.status).toBe(403);
  });

  test("logout rejected with wrong Origin", async () => {
    const res = await request("/api/auth/logout", {
      method: "POST",
      headers: { Origin: "https://evil.com" },
    });
    expect(res.status).toBe(403);
  });
});
