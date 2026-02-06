import { env } from "@/env";
import type { AuthUser, UserRole } from "@/types";
import { sign, verify } from "hono/jwt";

export function parseDuration(duration: string): number {
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
    "HS256",
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

interface RefreshTokenPayload {
  familyId: string;
  generation: number;
  userId: string;
}

export async function generateRefreshJWT(
  familyId: string,
  generation: number,
  userId: string,
): Promise<string> {
  return sign(
    {
      type: "refresh",
      fid: familyId,
      gen: generation,
      sub: userId,
    },
    env.REFRESH_JWT_SECRET,
    "HS256",
  );
}

export async function verifyRefreshJWT(
  token: string,
): Promise<RefreshTokenPayload | null> {
  try {
    const payload = await verify(token, env.REFRESH_JWT_SECRET, "HS256");

    if (
      payload.type !== "refresh" ||
      !payload.fid ||
      payload.gen === undefined ||
      !payload.sub
    ) {
      return null;
    }

    return {
      familyId: payload.fid as string,
      generation: payload.gen as number,
      userId: payload.sub as string,
    };
  } catch {
    return null;
  }
}
