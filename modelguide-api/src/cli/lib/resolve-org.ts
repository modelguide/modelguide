/**
 * Resolve an org slug to its UUID via direct DB query.
 * Uses forApp() to bypass RLS (organizations table has RLS enabled).
 */

import { forApp } from "@db/rls";
import { organizations } from "@db/schema";
import { eq } from "drizzle-orm";

export async function resolveOrgId(slug: string): Promise<string> {
  const [org] = await forApp(async (tx) => {
    return tx
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.slug, slug));
  });

  if (!org) {
    throw new Error(`Organization with slug "${slug}" not found`);
  }
  return org.id;
}
