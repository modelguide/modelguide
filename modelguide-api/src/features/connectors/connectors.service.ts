/**
 * Connectors service - business logic for connector and tool management
 */

import { db } from "@db/client";
import { forOrg } from "@db/rls";
import { connectorTools, connectors, connectorsCatalog } from "@db/schema";
import type { EntitySecretsMap } from "@db/schema";
import { decryptSecretsByIds } from "@features/secrets";
import { Errors, logAndThrow } from "@lib/errors";
import { getLogger, withTiming } from "@lib/logger";
import {
  type PaginationParams,
  buildPaginationMeta,
  getOffset,
} from "@lib/pagination";
import { toolSlug } from "@lib/slugify";
import { and, asc, count, eq, isNull } from "drizzle-orm";
import { getConnectorManifest } from "./catalog/registry";
import type { HealthCheckResult } from "./catalog/types";

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
    secrets?: EntitySecretsMap;
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
        secrets: data.secrets ?? {},
      })
      .returning();

    const catalogTools = catalogEntry.tools ?? [];
    if (catalogTools.length > 0) {
      await tx.insert(connectorTools).values(
        catalogTools.map((tool) => ({
          organizationId: orgId,
          connectorId: connector.id,
          name: tool.name,
          slug: toolSlug(tool.name),
          description: tool.description,
          toolSchema: tool.inputSchema,
          timeoutSeconds: tool.defaultTimeoutSeconds,
          isActive: true,
        })),
      );
    }

    getLogger().info(
      {
        connectorId: connector.id,
        slug: data.slug,
        tools: catalogTools.length,
      },
      "connector created",
    );

    return connector;
  });
}

export async function updateConnector(
  orgId: string,
  connectorId: string,
  data: {
    name?: string;
    config?: Record<string, unknown>;
    secrets?: EntitySecretsMap;
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

  getLogger().info({ connectorId }, "connector deleted");
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
      .where(
        and(
          eq(connectorTools.connectorId, connectorId),
          isNull(connectorTools.deletedAt),
        ),
      )
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
      .where(
        and(eq(connectorTools.id, toolId), isNull(connectorTools.deletedAt)),
      )
      .returning(),
  );

  if (!updated) {
    throw Errors.toolNotFound(toolId);
  }

  return updated;
}

// ============================================================================
// Config resolution (shared by ping + MCP tool execution)
// ============================================================================

/**
 * Resolve connector config, decrypting secrets from the entity's secrets map.
 * Reads connector.secrets map → fetches each UUID from org vault → decrypts.
 * Non-secret config fields are passed through as strings.
 * Missing vault entries throw MISSING_SECRET_REF (400).
 */
export async function resolveConnectorConfig(
  orgId: string,
  connector: { id: string; config: unknown; secrets: unknown },
  catalogConfigSchema: unknown,
): Promise<{ resolved: Record<string, string>; missingFields: string[] }> {
  const configSchema = (catalogConfigSchema ?? {}) as Record<
    string,
    { type: string; required?: boolean }
  >;
  const rawConfig = (connector.config ?? {}) as Record<string, unknown>;
  const secretsMap = (connector.secrets ?? {}) as EntitySecretsMap;

  // Batch-fetch and decrypt all referenced secrets via the secrets service
  const secretIds = Object.values(secretsMap).filter(Boolean);
  const decryptedById = await decryptSecretsByIds(orgId, secretIds);

  const resolved: Record<string, string> = {};
  const missingFields: string[] = [];

  for (const [key, fieldSchema] of Object.entries(configSchema)) {
    if (fieldSchema.type === "secret") {
      const secretId = secretsMap[key];
      if (!secretId) {
        if (fieldSchema.required) {
          missingFields.push(key);
        }
        continue;
      }
      const decrypted = decryptedById.get(secretId);
      if (!decrypted) {
        throw Errors.missingSecretRef(key, "connector", connector.id);
      }
      resolved[key] = decrypted;
    } else {
      // Non-secret field from config
      const value = rawConfig[key];
      if (value === undefined || value === null) {
        if (fieldSchema.required) {
          missingFields.push(key);
        }
        continue;
      }
      resolved[key] = String(value);
    }
  }

  return { resolved, missingFields };
}

// ============================================================================
// Health check / ping
// ============================================================================

export async function pingConnector(
  orgId: string,
  connectorId: string,
): Promise<HealthCheckResult> {
  const connector = await getConnectorById(orgId, connectorId);

  if (!connector.isActive) {
    throw Errors.connectorInactive(connectorId);
  }

  const catalog = await getCatalogEntry(connector.connectorCatalogId);
  const manifest = getConnectorManifest(catalog.slug);

  if (!manifest?.healthCheck) {
    throw Errors.validationError(
      `Connector type "${catalog.slug}" does not support health checks`,
    );
  }

  const { resolved, missingFields } = await resolveConnectorConfig(
    orgId,
    connector,
    catalog.configSchema,
  );

  if (missingFields.length > 0) {
    throw Errors.connectorNotConfigured(connectorId, {
      missingFields,
    });
  }

  const log = getLogger();
  const ctx = { connectorId, catalogSlug: catalog.slug };

  try {
    return await withTiming(
      log,
      ctx,
      "connector health check",
      "connector health check failed",
      () => manifest.healthCheck!(resolved),
    );
  } catch (err) {
    logAndThrow(
      log,
      err,
      { ...ctx, connectorSlug: connector.slug },
      "connector health check failed",
    );
  }
}
