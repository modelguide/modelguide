/**
 * Shared agent slug → ID resolution for commands that assign agents.
 */

import { listAgents } from "@features/agents/agents.service";
import type { IdRegistry } from "./id-registry";
import { log } from "./logger";

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

  const resolved: string[] = [];
  const unresolved: string[] = [];

  for (const slug of agentSlugs) {
    if (registry?.has("agent", slug)) {
      resolved.push(registry.get("agent", slug));
    } else {
      unresolved.push(slug);
    }
  }

  // DB fallback for slugs not in registry
  if (unresolved.length > 0) {
    const { data: agents } = await listAgents(orgId, {
      page: 1,
      pageSize: 100,
    });
    const agentMap = new Map(agents.map((a) => [a.slug, a.id]));
    for (const slug of unresolved) {
      const id = agentMap.get(slug);
      if (id) {
        resolved.push(id);
      } else {
        log.warn(`Agent "${slug}" not found, skipping assignment`);
      }
    }
  }

  return resolved;
}
