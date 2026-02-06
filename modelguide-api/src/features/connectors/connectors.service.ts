/**
 * Connectors service - business logic for connector and tool management
 */

import { db } from "@db/client";
import { forOrg } from "@db/rls";
import { connectorTools, connectors, connectorsCatalog } from "@db/schema";
import { Errors } from "@lib/errors";
import {
  type PaginationParams,
  buildPaginationMeta,
  getOffset,
} from "@lib/pagination";
import { and, asc, count, eq } from "drizzle-orm";

// ============================================================================
// Catalog queries (no RLS — global table)
// ============================================================================

export async function listCatalog(pagination: PaginationParams) {
  const { page, pageSize } = pagination;
  const offset = getOffset(page, pageSize);

  const [items, [{ total }]] = await Promise.all([
    db
      .select()
      .from(connectorsCatalog)
      .where(eq(connectorsCatalog.isActive, true))
      .orderBy(asc(connectorsCatalog.name))
      .limit(pageSize)
      .offset(offset),
    db
      .select({ total: count() })
      .from(connectorsCatalog)
      .where(eq(connectorsCatalog.isActive, true)),
  ]);

  return {
    data: items,
    pagination: buildPaginationMeta(page, pageSize, total),
  };
}

export async function getCatalogEntry(catalogId: string) {
  const [entry] = await db
    .select()
    .from(connectorsCatalog)
    .where(eq(connectorsCatalog.id, catalogId));

  if (!entry) {
    throw Errors.notFound("Catalog entry", catalogId);
  }

  return entry;
}

// ============================================================================
// Connector instance queries (RLS via forOrg)
// ============================================================================

export async function listConnectors(
  orgId: string,
  pagination: PaginationParams,
) {
  const { page, pageSize } = pagination;
  const offset = getOffset(page, pageSize);

  return forOrg(orgId, async (tx) => {
    const [items, [{ total }]] = await Promise.all([
      tx
        .select()
        .from(connectors)
        .orderBy(asc(connectors.createdAt))
        .limit(pageSize)
        .offset(offset),
      tx.select({ total: count() }).from(connectors),
    ]);

    return {
      data: items,
      pagination: buildPaginationMeta(page, pageSize, total),
    };
  });
}

export async function getConnectorById(orgId: string, connectorId: string) {
  const [connector] = await forOrg(orgId, (tx) =>
    tx.select().from(connectors).where(eq(connectors.id, connectorId)),
  );

  if (!connector) {
    throw Errors.connectorNotFound(connectorId);
  }

  return connector;
}

export async function createConnector(
  orgId: string,
  data: {
    connectorCatalogId: string;
    name: string;
    slug: string;
    config?: Record<string, unknown>;
  },
) {
  const [catalogEntry] = await db
    .select()
    .from(connectorsCatalog)
    .where(
      and(
        eq(connectorsCatalog.id, data.connectorCatalogId),
        eq(connectorsCatalog.isActive, true),
      ),
    );

  if (!catalogEntry) {
    throw Errors.notFound("Catalog entry", data.connectorCatalogId);
  }

  return forOrg(orgId, async (tx) => {
    const [existing] = await tx
      .select({ id: connectors.id })
      .from(connectors)
      .where(eq(connectors.slug, data.slug));

    if (existing) {
      throw Errors.alreadyExists("Connector", "slug");
    }

    const [connector] = await tx
      .insert(connectors)
      .values({
        organizationId: orgId,
        connectorCatalogId: data.connectorCatalogId,
        name: data.name,
        slug: data.slug,
        config: data.config ?? {},
      })
      .returning();

    const catalogTools = catalogEntry.tools ?? [];
    if (catalogTools.length > 0) {
      await tx.insert(connectorTools).values(
        catalogTools.map((tool) => ({
          organizationId: orgId,
          connectorId: connector.id,
          name: tool.name,
          slug: tool.name.toLowerCase().replace(/\s+/g, "_"),
          description: tool.description,
          toolSchema: tool.inputSchema,
          timeoutSeconds: tool.defaultTimeoutSeconds,
          isActive: true,
        })),
      );
    }

    return connector;
  });
}

export async function updateConnector(
  orgId: string,
  connectorId: string,
  data: {
    name?: string;
    config?: Record<string, unknown>;
    isActive?: boolean;
  },
) {
  const [updated] = await forOrg(orgId, (tx) =>
    tx
      .update(connectors)
      .set(data)
      .where(eq(connectors.id, connectorId))
      .returning(),
  );

  if (!updated) {
    throw Errors.connectorNotFound(connectorId);
  }

  return updated;
}

export async function deleteConnector(
  orgId: string,
  connectorId: string,
): Promise<void> {
  const [deleted] = await forOrg(orgId, (tx) =>
    tx
      .delete(connectors)
      .where(eq(connectors.id, connectorId))
      .returning({ id: connectors.id }),
  );

  if (!deleted) {
    throw Errors.connectorNotFound(connectorId);
  }
}

// ============================================================================
// Connector tool queries (RLS via forOrg)
// ============================================================================

export async function listConnectorTools(orgId: string, connectorId: string) {
  await getConnectorById(orgId, connectorId);

  return forOrg(orgId, (tx) =>
    tx
      .select()
      .from(connectorTools)
      .where(eq(connectorTools.connectorId, connectorId))
      .orderBy(asc(connectorTools.name)),
  );
}

export async function updateConnectorTool(
  orgId: string,
  toolId: string,
  data: { isActive?: boolean; timeoutSeconds?: number },
) {
  const [updated] = await forOrg(orgId, (tx) =>
    tx
      .update(connectorTools)
      .set(data)
      .where(eq(connectorTools.id, toolId))
      .returning(),
  );

  if (!updated) {
    throw Errors.toolNotFound(toolId);
  }

  return updated;
}
