/**
 * Refresh token session management.
 *
 * Security model:
 * - Refresh JWT is a signed carrier of { type, fid, gen, sub } — no `exp` claim.
 * - Expiry enforced by DB `expiresAt` only (single source of truth).
 * - Rotation uses atomic CAS (compare-and-swap) on generation counter.
 * - Reuse detection: generation gap > 1 → revoke entire session.
 * - Benign race (gap === 1): return 401 without revocation.
 */

import { env } from "@/env";
import type { AuthUser } from "@/types";
import { db } from "@db/client";
import { securityTokens, users } from "@db/schema";
import { Errors } from "@lib/errors";
import {
  generateJWT,
  generateRefreshJWT,
  parseDuration,
  verifyRefreshJWT,
} from "@lib/jwt";
import { withRLSBypass } from "@lib/middleware/rls";
import { and, eq, lt } from "drizzle-orm";

interface SessionTokens {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
}

/**
 * Create a new refresh session after successful authentication.
 */
export async function createSession(user: AuthUser): Promise<SessionTokens> {
  const ttl = parseDuration(env.REFRESH_TOKEN_EXPIRES_IN);
  const expiresAt = new Date(Date.now() + ttl * 1000);

  const [row] = await db
    .insert(securityTokens)
    .values({
      userId: user.id,
      generation: 0,
      expiresAt,
    })
    .returning({ familyId: securityTokens.familyId });

  const [accessToken, refreshToken] = await Promise.all([
    generateJWT(user),
    generateRefreshJWT(row.familyId, 0, user.id),
  ]);

  return { accessToken, refreshToken, user };
}

/**
 * Rotate a refresh token: verify → CAS bump generation → issue new tokens.
 */
export async function rotateRefreshToken(
  rawToken: string,
): Promise<SessionTokens> {
  // 1. Verify refresh JWT signature
  const payload = await verifyRefreshJWT(rawToken);
  if (!payload) {
    throw Errors.refreshTokenInvalid();
  }

  // 2. Look up session in DB
  const session = await db.query.securityTokens.findFirst({
    where: eq(securityTokens.familyId, payload.familyId),
  });

  if (!session || session.isRevoked) {
    throw Errors.refreshTokenInvalid();
  }

  // 3. Check expiry (DB is source of truth)
  if (session.expiresAt < new Date()) {
    throw Errors.refreshTokenExpired();
  }

  // 4. Reuse detection: token generation is more than 1 behind DB
  if (payload.generation < session.generation - 1) {
    // Definite reuse — revoke the entire session
    await db
      .update(securityTokens)
      .set({ isRevoked: true })
      .where(eq(securityTokens.familyId, payload.familyId));

    console.warn(
      `[SECURITY] Refresh token reuse detected for family=${payload.familyId}, token_gen=${payload.generation}, db_gen=${session.generation}`,
    );
    throw Errors.refreshTokenReused();
  }

  // 5. Benign race: another tab just rotated (gap of exactly 1)
  if (session.generation === payload.generation + 1) {
    console.info(
      `[REFRESH_IN_PROGRESS] Benign race for family=${payload.familyId}, token_gen=${payload.generation}, db_gen=${session.generation}`,
    );
    throw Errors.refreshTokenInvalid("Refresh already in progress");
  }

  // 6. Atomic CAS: bump generation, extend expiry
  const ttl = parseDuration(env.REFRESH_TOKEN_EXPIRES_IN);
  const newExpiresAt = new Date(Date.now() + ttl * 1000);
  const newGeneration = payload.generation + 1;

  const updated = await db
    .update(securityTokens)
    .set({
      generation: newGeneration,
      expiresAt: newExpiresAt,
    })
    .where(
      and(
        eq(securityTokens.familyId, payload.familyId),
        eq(securityTokens.generation, payload.generation),
      ),
    )
    .returning({ familyId: securityTokens.familyId });

  // 7. CAS miss — concurrent rotation won
  if (updated.length === 0) {
    console.info(
      `[REFRESH_IN_PROGRESS] CAS miss for family=${payload.familyId}, attempted_gen=${payload.generation}`,
    );
    throw Errors.refreshTokenInvalid("Refresh already in progress");
  }

  // 8. Look up user and issue new tokens
  const user = await withRLSBypass((tx) =>
    tx.query.users.findFirst({
      where: eq(users.id, payload.userId),
    }),
  );

  if (!user || !user.isActive) {
    // User deactivated between refreshes
    await db
      .update(securityTokens)
      .set({ isRevoked: true })
      .where(eq(securityTokens.familyId, payload.familyId));

    throw Errors.refreshTokenInvalid();
  }

  const authUser: AuthUser = {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    organizationId: user.organizationId,
  };

  const [accessToken, refreshToken] = await Promise.all([
    generateJWT(authUser),
    generateRefreshJWT(payload.familyId, newGeneration, user.id),
  ]);

  return { accessToken, refreshToken, user: authUser };
}

/**
 * Revoke a specific session. Requires generation match to prevent
 * an attacker with a stale token from force-logging out the victim.
 */
export async function revokeSession(
  familyId: string,
  expectedGeneration: number,
): Promise<boolean> {
  const updated = await db
    .update(securityTokens)
    .set({ isRevoked: true })
    .where(
      and(
        eq(securityTokens.familyId, familyId),
        eq(securityTokens.generation, expectedGeneration),
      ),
    )
    .returning({ familyId: securityTokens.familyId });

  return updated.length > 0;
}

/**
 * Revoke all sessions for a user (e.g., user deactivation).
 */
export async function revokeAllUserSessions(userId: string): Promise<number> {
  const updated = await db
    .update(securityTokens)
    .set({ isRevoked: true })
    .where(eq(securityTokens.userId, userId))
    .returning({ familyId: securityTokens.familyId });

  return updated.length;
}

/**
 * Delete expired sessions older than retention period.
 */
export async function cleanupExpiredSessions(): Promise<number> {
  const retentionDays = env.REFRESH_SESSION_RETENTION_DAYS;
  const cutoff = new Date(
    Date.now() - retentionDays * 24 * 60 * 60 * 1000,
  );

  const deleted = await db
    .delete(securityTokens)
    .where(lt(securityTokens.expiresAt, cutoff))
    .returning({ familyId: securityTokens.familyId });

  return deleted.length;
}
