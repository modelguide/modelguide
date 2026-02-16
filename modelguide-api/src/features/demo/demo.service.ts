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
