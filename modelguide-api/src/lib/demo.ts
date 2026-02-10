/**
 * Demo mode helpers.
 * Isolated from core auth — only active when DEMO_MODE_ENABLED=true.
 */

import { env } from "@/env";
import { db } from "@db/client";
import { organizations } from "@db/schema";
import { eq } from "drizzle-orm";

// Cached for process lifetime — restart required if demo org is recreated
let cachedDemoOrgId: string | null = null;

export function isDemoEnabled(): boolean {
  return env.DEMO_MODE_ENABLED === true;
}

export async function getDemoOrgId(): Promise<string> {
  if (cachedDemoOrgId) return cachedDemoOrgId;

  const org = await db.query.organizations.findFirst({
    where: eq(organizations.slug, env.DEMO_ORG_SLUG),
  });

  if (!org) {
    throw new Error(
      `Demo organization with slug "${env.DEMO_ORG_SLUG}" not found. Run the seed script first.`,
    );
  }

  cachedDemoOrgId = org.id;
  return cachedDemoOrgId;
}
