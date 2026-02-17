/**
 * Refresh token session management.
 *
 * All security_tokens operations use raw `db` because the table has no RLS.
 * User lookups use `forApp` because the `users` table has RLS.
 *
 * Security model:
 * - Refresh JWT is a signed carrier of { type, fid, gen, sub } — no `exp` claim.
 * - Expiry enforced by DB `expiresAt` only (single source of truth).
 * - Rotation uses atomic CAS (compare-and-swap) on generation counter.
 * - Reuse detection runs after CAS miss to avoid TOCTOU race with 3+ tabs.
 * - Benign race (gap === 1): return 401 without revocation.
 */

import { env } from "@/env";
import type { AuthUser } from "@/types";
import { db } from "@db/client";
import { forApp } from "@db/rls";
import { securityTokens, users } from "@db/schema";
import { Errors } from "@lib/errors";
import {
  generateJWT,
  generateRefreshJWT,
  parseDuration,
  verifyRefreshJWT,
} from "@lib/jwt";
import { and, eq, lt } from "drizzle-orm";

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
}

/**
 * Create a new refresh session after successful authentication.
 */
export async function createSession(
  user: AuthUser,
  options?: { refreshTtl?: string },
): Promise<SessionTokens> {
  const ttl = parseDuration(
    options?.refreshTtl ?? env.REFRESH_TOKEN_EXPIRES_IN,
  );
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
 *
 * Reuse detection is performed AFTER the CAS attempt to avoid TOCTOU races
 * when 3+ tabs refresh concurrently.
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

  // 4. Atomic CAS: bump generation, extend expiry
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

  // 5. CAS miss — determine if benign race or reuse
  if (updated.length === 0) {
    const currentSession = await db.query.securityTokens.findFirst({
      where: eq(securityTokens.familyId, payload.familyId),
    });

    if (
      currentSession &&
      !currentSession.isRevoked &&
      payload.generation < currentSession.generation - 1
    ) {
      // Definite reuse — revoke the entire session
      await db
        .update(securityTokens)
        .set({ isRevoked: true })
        .where(eq(securityTokens.familyId, payload.familyId));

      console.warn(
        `[SECURITY] Refresh token reuse detected for family=${payload.familyId}, token_gen=${payload.generation}, db_gen=${currentSession.generation}`,
      );
      throw Errors.refreshTokenReused();
    }

    // Benign race (gap of 1) or already revoked
    console.info(
      `[REFRESH_IN_PROGRESS] CAS miss for family=${payload.familyId}, attempted_gen=${payload.generation}`,
    );
    throw Errors.refreshTokenInvalid("Refresh already in progress");
  }

  // 6. Look up user (RLS-bypassed) and issue new tokens
  const user = await forApp((tx) =>
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
 * Revoke a specific session by familyId (no generation check).
 * Used for logout — always revokes regardless of generation to prevent
 * stale sessions lingering after user clicks logout.
 */
export async function revokeSession(familyId: string): Promise<boolean> {
  const updated = await db
    .update(securityTokens)
    .set({ isRevoked: true })
    .where(eq(securityTokens.familyId, familyId))
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
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

  const deleted = await db
    .delete(securityTokens)
    .where(lt(securityTokens.expiresAt, cutoff))
    .returning({ familyId: securityTokens.familyId });

  return deleted.length;
}
