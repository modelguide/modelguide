/**
 * Demo login service.
 * Creates a session for the shared demo viewer user and captures the visitor's
 * email as a lead. Completely isolated from core auth (auth.service.ts).
 */

import { resolveMx } from "node:dns/promises";
import type { AuthUser } from "@/types";
import { db } from "@db/client";
import { forApp } from "@db/rls";
import { demoUsers, users } from "@db/schema";
import { createSession } from "@features/users/refresh-token.service";
import { getDemoOrgId, isDemoEnabled } from "@lib/demo";
import { Errors } from "@lib/errors";
import { and, eq } from "drizzle-orm";

interface DemoLoginResult {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
}

export async function demoLogin(
  email: string,
  source?: string,
): Promise<DemoLoginResult> {
  if (!isDemoEnabled()) {
    throw Errors.notFound("Not found");
  }

  // Quick MX check — reject emails with non-existent domains
  const domain = email.split("@")[1];
  try {
    const records = await resolveMx(domain);
    if (!records || records.length === 0) {
      throw Errors.validationError("Email domain does not accept mail");
    }
  } catch (err) {
    if (err instanceof Error && "code" in err) {
      throw Errors.validationError("Email domain does not accept mail");
    }
    throw err;
  }

  const demoOrgId = await getDemoOrgId();

  // Fire-and-forget lead capture — should not block demo login
  db.insert(demoUsers)
    .values({ email, source: source ?? null })
    .catch((err) => {
      console.warn("[demo] Failed to capture lead:", err.message);
    });

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
    name: "Demo User",
    role: "viewer",
    organizationId: demoOrgId,
    demo: true,
  };

  return createSession(authUser);
}
