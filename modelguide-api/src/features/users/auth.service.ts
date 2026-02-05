/**
 * Authentication service for magic link authentication
 */

import type { AuthUser } from "@/types";
import { db } from "@db/client";
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
import { withRLSBypass } from "@lib/middleware/rls";
import { and, eq, isNull, lt } from "drizzle-orm";

/**
 * Request a magic link for login
 * Returns success even if user doesn't exist (to prevent enumeration)
 */
export async function requestMagicLink(email: string): Promise<void> {
  // Find user by email (bypass RLS since we don't know org yet)
  const user = await withRLSBypass((tx) =>
    tx.query.users.findFirst({
      where: eq(users.email, email.toLowerCase()),
    }),
  );

  // If user doesn't exist or is inactive, silently succeed
  // This prevents email enumeration attacks
  if (!user || !user.isActive) {
    return;
  }

  // Generate magic link
  const { tokenHash, link, expiresAt } = createMagicLink();

  // Store token hash in database (magic_tokens has no RLS)
  await db.insert(magicTokens).values({
    userId: user.id,
    tokenHash,
    expiresAt,
  });

  // Send magic link
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

  // Find token by hash (magic_tokens has no RLS)
  const magicToken = await db.query.magicTokens.findFirst({
    where: eq(magicTokens.tokenHash, tokenHash),
  });

  if (!magicToken) {
    throw Errors.magicTokenInvalid();
  }

  // Check if token has been used
  if (isMagicTokenUsed(magicToken.usedAt)) {
    throw Errors.magicTokenUsed();
  }

  // Check if token has expired
  if (isMagicTokenExpired(magicToken.expiresAt)) {
    throw Errors.magicTokenExpired();
  }

  // Fetch user (bypass RLS since we don't have org context yet)
  const user = await withRLSBypass((tx) =>
    tx.query.users.findFirst({
      where: eq(users.id, magicToken.userId),
    }),
  );

  if (!user) {
    throw Errors.magicTokenInvalid();
  }

  // Check if user is still active
  if (!user.isActive) {
    throw Errors.userInactive();
  }

  // Atomically mark token as used, preventing race conditions
  // Only updates if token is still unused (usedAt IS NULL)
  const updateResult = await db
    .update(magicTokens)
    .set({ usedAt: new Date() })
    .where(and(eq(magicTokens.id, magicToken.id), isNull(magicTokens.usedAt)))
    .returning({ id: magicTokens.id });

  // If no rows were updated, token was used by a concurrent request
  if (updateResult.length === 0) {
    throw Errors.magicTokenUsed();
  }

  // Update user's last login (bypass RLS)
  await withRLSBypass((tx) =>
    tx
      .update(users)
      .set({ lastLoginAt: new Date() })
      .where(eq(users.id, user.id)),
  );

  // Generate JWT
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
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
  });

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
