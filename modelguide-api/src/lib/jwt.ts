/**
 * JWT generation and verification utilities
 */

import { env } from "@/env";
import type { AuthUser } from "@/types";
import { type JWTPayload, SignJWT, jwtVerify } from "jose";

/**
 * JWT payload structure
 */
export interface JWTTokenPayload extends JWTPayload {
  sub: string; // User ID
  email: string;
  name: string;
  role: "admin" | "support";
  org: string; // Organization ID
}

/**
 * Parse duration string to seconds
 * Supports: 1h, 24h, 7d, 30d, etc.
 */
function parseDuration(duration: string): number {
  const match = duration.match(/^(\d+)([hdm])$/);
  if (!match) {
    throw new Error(`Invalid duration format: ${duration}`);
  }

  const value = Number.parseInt(match[1], 10);
  const unit = match[2];

  switch (unit) {
    case "h":
      return value * 60 * 60;
    case "d":
      return value * 24 * 60 * 60;
    case "m":
      return value * 60;
    default:
      throw new Error(`Unknown duration unit: ${unit}`);
  }
}

/**
 * Get the secret key for JWT signing/verification
 */
function getSecretKey(): Uint8Array {
  return new TextEncoder().encode(env.JWT_SECRET);
}

/**
 * Generate a JWT token for an authenticated user
 */
export async function generateJWT(user: AuthUser): Promise<string> {
  const secretKey = getSecretKey();
  const expiresIn = parseDuration(env.JWT_EXPIRES_IN);

  const jwt = await new SignJWT({
    email: user.email,
    name: user.name,
    role: user.role,
    org: user.organizationId,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + expiresIn)
    .sign(secretKey);

  return jwt;
}

/**
 * Verify and decode a JWT token
 * Returns the user payload if valid, null if invalid/expired
 */
export async function verifyJWT(token: string): Promise<AuthUser | null> {
  try {
    const secretKey = getSecretKey();
    const { payload } = await jwtVerify(token, secretKey);

    const typedPayload = payload as JWTTokenPayload;

    if (
      !typedPayload.sub ||
      !typedPayload.email ||
      !typedPayload.role ||
      !typedPayload.org
    ) {
      return null;
    }

    return {
      id: typedPayload.sub,
      email: typedPayload.email,
      name: typedPayload.name || "",
      role: typedPayload.role,
      organizationId: typedPayload.org,
    };
  } catch {
    return null;
  }
}

/**
 * Check if a JWT token is expired without full verification
 * Useful for determining if token should be refreshed
 */
export function isTokenExpired(token: string): boolean {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return true;

    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString());
    if (!payload.exp) return true;

    return payload.exp * 1000 < Date.now();
  } catch {
    return true;
  }
}
