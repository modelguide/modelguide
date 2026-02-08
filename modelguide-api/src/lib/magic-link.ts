/**
 * Magic link utilities for passwordless authentication
 */

import { env } from "@/env";
import { generateMagicToken, hashMagicToken } from "./crypto";
import { getSender } from "./magic-link-sender";

/**
 * Result of generating a magic link
 */
export interface GeneratedMagicLink {
  /** The raw token (sent in link) */
  token: string;
  /** SHA-256 hash of token (stored in DB) */
  tokenHash: string;
  /** Full magic link URL */
  link: string;
  /** Token expiration timestamp */
  expiresAt: Date;
}

/**
 * Generate a magic link for passwordless authentication
 */
export function createMagicLink(): GeneratedMagicLink {
  const token = generateMagicToken();
  const tokenHash = hashMagicToken(token);
  const link = buildMagicLinkUrl(token);
  const expiresAt = new Date(
    Date.now() + env.MAGIC_LINK_EXPIRES_IN_MINUTES * 60 * 1000,
  );

  return {
    token,
    tokenHash,
    link,
    expiresAt,
  };
}

/**
 * Build the full magic link URL
 */
export function buildMagicLinkUrl(token: string): string {
  const baseUrl = env.APP_URL.replace(/\/$/, ""); // Remove trailing slash
  return `${baseUrl}/auth/verify?token=${encodeURIComponent(token)}`;
}

/**
 * Send magic link to user via the configured delivery strategy
 */
export async function sendMagicLink(
  email: string,
  link: string,
  userName?: string,
): Promise<void> {
  const sender = getSender();
  await sender.send(email, link, userName);
}

/**
 * Check if a magic token has expired
 */
export function isMagicTokenExpired(expiresAt: Date): boolean {
  return new Date() > expiresAt;
}

/**
 * Check if a magic token has been used
 */
export function isMagicTokenUsed(usedAt: Date | null): boolean {
  return usedAt !== null;
}
