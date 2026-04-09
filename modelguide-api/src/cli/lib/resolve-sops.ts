/**
 * Shared SOP slug → {id, name} resolution for commands that reference SOPs.
 */

import { forOrg } from "@db/rls";
import { sops } from "@db/schema";
import { inArray } from "drizzle-orm";
import type { IdRegistry } from "./id-registry";
import { log } from "./logger";

export interface ResolvedSop {
  id: string;
  name: string;
}

export async function lookupSopIds(
  orgId: string,
  sopSlugs: string[],
  registry?: IdRegistry,
): Promise<Map<string, ResolvedSop>> {
  const resolved = new Map<string, ResolvedSop>();
  const uniqueSlugs = [...new Set(sopSlugs)];

  if (uniqueSlugs.length === 0) {
    return resolved;
  }

  // Check registry first (for setup pipeline where SOPs were just created)
  const registrySopIds = registry?.getAll("sop");

  for (const slug of uniqueSlugs) {
    const id = registrySopIds?.get(slug);
    if (id) {
      resolved.set(slug, { id, name: slug });
    }
  }

  // Always query DB for all slugs — we need the real name even for registry hits
  const rows = await forOrg(orgId, (tx) =>
    tx
      .select({ id: sops.id, slug: sops.slug, name: sops.name })
      .from(sops)
      .where(inArray(sops.slug, uniqueSlugs)),
  );

  for (const row of rows) {
    resolved.set(row.slug, { id: row.id, name: row.name });
  }

  // Warn about unresolved slugs
  for (const slug of uniqueSlugs) {
    if (!resolved.has(slug)) {
      log.warn(`SOP "${slug}" not found in organization, skipping`);
    }
  }

  return resolved;
}
