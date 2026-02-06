/**
 * Authentication service for magic link authentication
 */

import type { AuthUser } from "@/types";
import { db } from "@db/client";
import { forApp } from "@db/rls";
import { magicTokens, users } from "@db/schema";
import { hashMagicToken } from "@lib/crypto";
import { Errors } from "@lib/errors";
import { generateJWT } from "@lib/jwt";
import {
  createMagicLink,
  isMagicTokenExpired,
  isMagicTokenUsed,
  sendMagicLink,
} from "@lib/magic-link";
import { and, eq, isNull, lt } from "drizzle-orm";

/**
 * Request a magic link for login
 * Returns success even if user doesn't exist (to prevent enumeration)
 */
export async function requestMagicLink(email: string): Promise<void> {
  const user = await forApp((tx) =>
    tx.query.users.findFirst({
      where: eq(users.email, email.toLowerCase()),
    }),
  );

  // Silently succeed for non-existent/inactive users to prevent email enumeration
  if (!user || !user.isActive) {
    return;
  }

  const { tokenHash, link, expiresAt } = createMagicLink();

  await db.insert(magicTokens).values({
    userId: user.id,
    tokenHash,
    expiresAt,
  });

  await sendMagicLink(user.email, link, user.name);
}

/**
 * Verify magic link token and return JWT
 * Uses atomic update to prevent race conditions with concurrent requests
 */
export async function verifyMagicToken(token: string): Promise<{
  token: string;
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

  const jwt = await generateJWT(authUser);

  return {
    token: jwt,
    user: authUser,
  };
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
export async function cleanupExpiredTokens(): Promise<number> {
  const now = new Date();
  const result = await db
    .delete(magicTokens)
    .where(lt(magicTokens.expiresAt, now))
    .returning({ id: magicTokens.id });

  return result.length;
}
