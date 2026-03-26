/**
 * Shared connector resolution for CLI commands that reference connectors by slug.
 */

import { forOrg } from "@db/rls";
import { connectorTools, connectors } from "@db/schema";
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { IdRegistry } from "./id-registry";

function assertResolvedConnectorSlugs(
  connectorSlugs: string[],
  resolved: Map<string, string>,
): void {
  const missing = [...new Set(connectorSlugs)].filter(
    (slug) => !resolved.has(slug),
  );

  if (missing.length > 0) {
    throw new Error(
      `Connectors not found in organization: ${missing.join(", ")}`,
    );
  }
}

async function lookupConnectorIds(
  orgId: string,
  connectorSlugs: string[],
  registry?: IdRegistry,
): Promise<Map<string, string>> {
  const resolved = new Map<string, string>();
  const uniqueSlugs = [...new Set(connectorSlugs)];

  if (uniqueSlugs.length === 0) {
    return resolved;
  }

  const registryConnectors = registry?.getAll("connector");
  for (const slug of uniqueSlugs) {
    const id = registryConnectors?.get(slug);
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
      .select({ id: connectors.id, slug: connectors.slug })
      .from(connectors)
      .where(inArray(connectors.slug, missingSlugs)),
  );

  for (const row of rows) {
    resolved.set(row.slug, row.id);
  }

  return resolved;
}

export async function resolveConnectorMappingIds(
  orgId: string,
  mapping: Record<string, string> | undefined,
  registry?: IdRegistry,
): Promise<Record<string, string>> {
  if (!mapping) {
    return {};
  }

  const connectorSlugs = Object.values(mapping);
  const connectorIds = await lookupConnectorIds(
    orgId,
    connectorSlugs,
    registry,
  );
  assertResolvedConnectorSlugs(connectorSlugs, connectorIds);

  return Object.fromEntries(
    Object.entries(mapping).map(([catalogSlug, connectorSlug]) => [
      catalogSlug,
      connectorIds.get(connectorSlug)!,
    ]),
  );
}

export async function resolveConnectorToolReference(
  orgId: string,
  connectorSlug: string,
  toolSlug: string,
): Promise<string> {
  const [row] = await forOrg(orgId, (tx) =>
    tx
      .select({ connectorToolId: connectorTools.id })
      .from(connectors)
      .innerJoin(
        connectorTools,
        and(
          eq(connectorTools.connectorId, connectors.id),
          eq(connectorTools.slug, toolSlug),
          isNull(connectorTools.deletedAt),
        ),
      )
      .where(eq(connectors.slug, connectorSlug))
      .limit(1),
  );

  if (!row) {
    throw new Error(
      `Tool "${toolSlug}" not found on connector "${connectorSlug}"`,
    );
  }

  return row.connectorToolId;
}
