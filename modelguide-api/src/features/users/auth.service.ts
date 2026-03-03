/**
 * Authentication service (magic link + demo instant auth).
 */

import { env } from "@/env";
import type { AuthUser } from "@/types";
import { db } from "@db/client";
import { forApp } from "@db/rls";
import { magicTokens, organizations, users } from "@db/schema";
import { hashMagicToken, maskPII } from "@lib/crypto";
import { Errors } from "@lib/errors";
import { getLogger } from "@lib/logger";
import {
  createMagicLink,
  isMagicTokenExpired,
  isMagicTokenUsed,
  sendMagicLink,
} from "@lib/magic-link";
import { and, eq, isNull, lt } from "drizzle-orm";
import {
  type SessionTokens,
  cleanupExpiredSessions,
  createSession,
} from "./refresh-token.service";

export const DEMO_REFRESH_TTL = "8h";

export const LOGIN_RESULT = {
  MAGIC_LINK_SENT: "magic_link_sent",
  DEMO_AUTHENTICATED: "demo_authenticated",
} as const;

type LoginResult =
  | { type: typeof LOGIN_RESULT.MAGIC_LINK_SENT }
  | { type: typeof LOGIN_RESULT.DEMO_AUTHENTICATED; session: SessionTokens };

/**
 * Unified login by email.
 * Demo viewers in demo-enabled orgs get instant auth (200 + tokens).
 * All other cases get a magic link (202 + message) — including non-existent
 * users and inactive users (anti-enumeration).
 */
export async function loginByEmail(email: string): Promise<LoginResult> {
  const normalizedEmail = email.toLowerCase();
  const safeEmail = maskPII(normalizedEmail);
  getLogger().info({ email: safeEmail }, "login requested");

  // Single JOIN query: user + org to check demoEnabled
  const row = await forApp((tx) =>
    tx
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        role: users.role,
        organizationId: users.organizationId,
        isActive: users.isActive,
        demoEnabled: organizations.demoEnabled,
      })
      .from(users)
      .innerJoin(organizations, eq(users.organizationId, organizations.id))
      .where(eq(users.email, normalizedEmail))
      .limit(1)
      .then((rows) => rows[0] ?? null),
  );

  // User not found or inactive — return magic_link_sent (anti-enumeration)
  if (!row) {
    getLogger().warn(
      { email: safeEmail },
      "no user found — anti-enumeration response",
    );
    return { type: LOGIN_RESULT.MAGIC_LINK_SENT };
  }
  if (!row.isActive) {
    getLogger().warn(
      { email: safeEmail },
      "user inactive — anti-enumeration response",
    );
    return { type: LOGIN_RESULT.MAGIC_LINK_SENT };
  }

  // Demo path: viewer in a demo-enabled org → instant auth
  if (row.demoEnabled && row.role === "viewer") {
    getLogger().info(
      { email: safeEmail },
      "demo login (viewer in demo-enabled org)",
    );

    await forApp((tx) =>
      tx
        .update(users)
        .set({ lastLoginAt: new Date() })
        .where(eq(users.id, row.id)),
    );

    const authUser: AuthUser = {
      id: row.id,
      email: row.email,
      name: row.name,
      role: row.role,
      organizationId: row.organizationId,
    };

    const session = await createSession(authUser, {
      refreshTtl: DEMO_REFRESH_TTL,
    });
    return { type: LOGIN_RESULT.DEMO_AUTHENTICATED, session };
  }

  // Standard path: send magic link
  const { tokenHash, link, expiresAt } = createMagicLink();

  await db.insert(magicTokens).values({
    userId: row.id,
    tokenHash,
    expiresAt,
  });

  try {
    await sendMagicLink(row.email, link, row.name);
    getLogger().info(
      { email: safeEmail, strategy: env.MAGIC_LINK_STRATEGY },
      "magic link sent",
    );
  } catch (err) {
    getLogger().error({ err }, "failed to send magic link");
    // Swallow to preserve anti-enumeration
  }

  return { type: LOGIN_RESULT.MAGIC_LINK_SENT };
}

/**
 * Verify magic link token and return JWT
 * Uses atomic update to prevent race conditions with concurrent requests
 */
export async function verifyMagicToken(token: string): Promise<{
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
}> {
  const tokenHash = hashMagicToken(token);

  const magicToken = await db.query.magicTokens.findFirst({
    where: eq(magicTokens.tokenHash, tokenHash),
  });

  if (!magicToken) {
    throw Errors.magicTokenInvalid();
  }

  if (isMagicTokenUsed(magicToken.usedAt)) {
    throw Errors.magicTokenUsed();
  }

  if (isMagicTokenExpired(magicToken.expiresAt)) {
    throw Errors.magicTokenExpired();
  }

  const user = await forApp((tx) =>
    tx.query.users.findFirst({
      where: eq(users.id, magicToken.userId),
    }),
  );

  if (!user) {
    throw Errors.magicTokenInvalid();
  }

  if (!user.isActive) {
    throw Errors.userInactive();
  }

  // Atomically mark token as used to prevent race conditions
  const updateResult = await db
    .update(magicTokens)
    .set({ usedAt: new Date() })
    .where(and(eq(magicTokens.id, magicToken.id), isNull(magicTokens.usedAt)))
    .returning({ id: magicTokens.id });

  if (updateResult.length === 0) {
    throw Errors.magicTokenUsed();
  }

  await forApp((tx) =>
    tx
      .update(users)
      .set({ lastLoginAt: new Date() })
      .where(eq(users.id, user.id)),
  );

  const authUser: AuthUser = {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    organizationId: user.organizationId,
  };

  return createSession(authUser);
}

/**
 * Get current user information
 */
export async function getUserById(userId: string): Promise<AuthUser | null> {
  const user = await forApp((tx) =>
    tx.query.users.findFirst({
      where: eq(users.id, userId),
    }),
  );

  if (!user || !user.isActive) {
    return null;
  }

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    organizationId: user.organizationId,
  };
}

/**
 * Clean up expired magic tokens (both used and unused)
 * Call this periodically (e.g., via cron job)
 */
export async function cleanupExpiredTokens(): Promise<{
  magicTokens: number;
  sessions: number;
}> {
  const now = new Date();
  const result = await db
    .delete(magicTokens)
    .where(lt(magicTokens.expiresAt, now))
    .returning({ id: magicTokens.id });

  const sessionsDeleted = await cleanupExpiredSessions();

  if (result.length > 0 || sessionsDeleted > 0) {
    getLogger().info(
      { magicTokens: result.length, sessions: sessionsDeleted },
      "expired tokens cleaned up",
    );
  }

  return { magicTokens: result.length, sessions: sessionsDeleted };
}
