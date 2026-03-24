/**
 * Resolve an org slug to its UUID via direct DB query.
 */

import { db } from "@db/client";
import { organizations } from "@db/schema";
import { eq } from "drizzle-orm";

export async function resolveOrgId(slug: string): Promise<string> {
  const [org] = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.slug, slug));

  if (!org) {
    throw new Error(`Organization with slug "${slug}" not found`);
  }
  return org.id;
}
