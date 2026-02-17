/**
 * Demo login service.
 * Creates a session for the shared demo viewer user.
 * Completely isolated from core auth (auth.service.ts).
 */

import { resolveMx } from "node:dns/promises";
import type { AuthUser } from "@/types";
import { forApp } from "@db/rls";
import { users } from "@db/schema";
import { createSession } from "@features/users/refresh-token.service";
import { getDemoOrgId, isDemoEnabled } from "@lib/demo";
import { Errors } from "@lib/errors";
import { and, eq } from "drizzle-orm";

// MX lookup cache: avoids repeated DNS lookups for the same domain
const MX_CACHE_MAX_SIZE = 256;
const MX_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface MxCacheEntry {
  valid: boolean;
  expiresAt: number;
}

const mxCache = new Map<string, MxCacheEntry>();

async function hasMxRecords(domain: string): Promise<boolean> {
  const now = Date.now();
  const cached = mxCache.get(domain);
  if (cached && cached.expiresAt > now) return cached.valid;

  let valid: boolean;
  try {
    const records = await resolveMx(domain);
    valid = !!records && records.length > 0;
  } catch (err) {
    if (err instanceof Error && "code" in err) {
      valid = false;
    } else {
      throw err;
    }
  }

  // Evict oldest entries when cache is full
  if (mxCache.size >= MX_CACHE_MAX_SIZE) {
    const firstKey = mxCache.keys().next().value;
    if (firstKey) mxCache.delete(firstKey);
  }

  mxCache.set(domain, { valid, expiresAt: now + MX_CACHE_TTL_MS });
  return valid;
}

interface DemoLoginResult {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
}

export async function demoLogin(email: string): Promise<DemoLoginResult> {
  if (!isDemoEnabled()) {
    throw Errors.notFound("Not found");
  }

  // Quick MX check — reject emails with non-existent domains
  const domain = email.split("@")[1];
  if (!(await hasMxRecords(domain))) {
    throw Errors.validationError("Email domain does not accept mail");
  }

  const demoOrgId = await getDemoOrgId();

  // Look up the shared demo viewer user
  const demoViewer = await forApp((tx) =>
    tx.query.users.findFirst({
      where: and(
        eq(users.organizationId, demoOrgId),
        eq(users.role, "viewer"),
        eq(users.isActive, true),
      ),
    }),
  );

  if (!demoViewer) {
    throw new Error(
      "Demo viewer user not found. Run the seed script to create demo data.",
    );
  }

  const authUser: AuthUser = {
    id: demoViewer.id,
    email: demoViewer.email,
    name: demoViewer.name,
    role: "viewer",
    organizationId: demoOrgId,
  };

  return createSession(authUser);
}
