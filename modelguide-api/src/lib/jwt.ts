import { env } from "@/env";
import type { AuthUser, UserRole } from "@/types";
import { sign, verify } from "hono/jwt";

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

export async function generateJWT(user: AuthUser): Promise<string> {
  const expiresIn = parseDuration(env.JWT_EXPIRES_IN);
  const now = Math.floor(Date.now() / 1000);

  return sign(
    {
      sub: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      org: user.organizationId,
      iat: now,
      exp: now + expiresIn,
    },
    env.JWT_SECRET,
  );
}

export async function verifyJWT(token: string): Promise<AuthUser | null> {
  try {
    const payload = await verify(token, env.JWT_SECRET, "HS256");

    if (!payload.sub || !payload.email || !payload.role || !payload.org) {
      return null;
    }

    return {
      id: payload.sub as string,
      email: payload.email as string,
      name: (payload.name as string) || "",
      role: payload.role as UserRole,
      organizationId: payload.org as string,
    };
  } catch {
    return null;
  }
}
