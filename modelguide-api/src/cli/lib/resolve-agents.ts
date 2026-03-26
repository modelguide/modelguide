/**
 * Shared agent slug → ID resolution for commands that assign agents.
 */

import { forOrg } from "@db/rls";
import { agents } from "@db/schema";
import { inArray } from "drizzle-orm";
import type { IdRegistry } from "./id-registry";
import { log } from "./logger";

function assertResolvedAgentSlugs(
  agentSlugs: string[],
  resolved: Map<string, string>,
): void {
  const missing = [...new Set(agentSlugs)].filter(
    (slug) => !resolved.has(slug),
  );

  if (missing.length > 0) {
    throw new Error(`Agents not found in organization: ${missing.join(", ")}`);
  }
}

export async function lookupAgentIds(
  orgId: string,
  agentSlugs: string[],
  registry?: IdRegistry,
): Promise<Map<string, string>> {
  const resolved = new Map<string, string>();
  const uniqueSlugs = [...new Set(agentSlugs)];

  if (uniqueSlugs.length === 0) {
    return resolved;
  }

  const registryAgentIds = registry?.getAll("agent");

  for (const slug of uniqueSlugs) {
    const id = registryAgentIds?.get(slug);
    if (id) {
      resolved.set(slug, id);
    }
  }

  const missingSlugs = uniqueSlugs.filter((slug) => !resolved.has(slug));
  if (missingSlugs.length === 0) {
    return resolved;
  }

  const rows = await forOrg(orgId, (tx) =>
    tx
      .select({ id: agents.id, slug: agents.slug })
      .from(agents)
      .where(inArray(agents.slug, missingSlugs)),
  );

  for (const row of rows) {
    resolved.set(row.slug, row.id);
  }

  return resolved;
}

/**
 * Resolve agent slugs to UUIDs using registry and/or DB lookup.
 * Warns on unresolvable slugs instead of silently dropping them.
 */
export async function resolveAgentIds(
  orgId: string,
  agentSlugs: string[],
  registry?: IdRegistry,
): Promise<string[]> {
  if (agentSlugs.length === 0) return [];

  const agentMap = await lookupAgentIds(orgId, agentSlugs, registry);
  const resolved: string[] = [];

  for (const slug of agentSlugs) {
    const id = agentMap.get(slug);
    if (id) {
      resolved.push(id);
    } else {
      log.warn(`Agent "${slug}" not found, skipping assignment`);
    }
  }

  return resolved;
}

export async function requireAgentIds(
  orgId: string,
  agentSlugs: string[],
  registry?: IdRegistry,
): Promise<string[]> {
  const agentMap = await lookupAgentIds(orgId, agentSlugs, registry);
  assertResolvedAgentSlugs(agentSlugs, agentMap);
  return agentSlugs.map((slug) => agentMap.get(slug)!);
}
