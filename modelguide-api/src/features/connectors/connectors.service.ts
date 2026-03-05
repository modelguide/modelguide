/**
 * Connectors service - business logic for connector and tool management
 */

import { db } from "@db/client";
import { forOrg } from "@db/rls";
import {
  connectorTools,
  connectors,
  connectorsCatalog,
  secrets,
} from "@db/schema";
import { decryptSecret } from "@lib/crypto";
import { Errors, logAndThrow } from "@lib/errors";
import { getLogger, withTiming } from "@lib/logger";
import {
  type PaginationParams,
  buildPaginationMeta,
  getOffset,
} from "@lib/pagination";
import { toolSlug } from "@lib/slugify";
import { and, asc, count, eq, inArray, isNull } from "drizzle-orm";
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
    isActive?: boolean;
  },
) {
  // Validate config against catalog configSchema when config is provided
  if (data.config) {
    await validateConnectorConfig(orgId, connectorId, data.config);
  }

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

/**
 * Validate connector config against the catalog's configSchema.
 * Checks that secret references (UUID values for "secret" type fields) exist in the org.
 */
async function validateConnectorConfig(
  orgId: string,
  connectorId: string,
  config: Record<string, unknown>,
): Promise<void> {
  // Look up the connector to get its catalog entry
  const connector = await getConnectorById(orgId, connectorId);
  const catalog = await getCatalogEntry(connector.connectorCatalogId);

  const configSchema = (catalog.configSchema ?? {}) as Record<
    string,
    { type: string; required?: boolean }
  >;

  // Validate secret references exist in the org
  const missingSecrets: string[] = [];
  const secretIds: string[] = [];

  for (const [key, fieldSchema] of Object.entries(configSchema)) {
    const value = config[key];
    if (fieldSchema.type === "secret" && typeof value === "string" && value) {
      secretIds.push(value);
    }
  }

  if (secretIds.length > 0) {
    const foundSecrets = await forOrg(orgId, (tx) =>
      tx
        .select({ id: secrets.id })
        .from(secrets)
        .where(inArray(secrets.id, secretIds)),
    );

    const foundIds = new Set(foundSecrets.map((s) => s.id));

    for (const [key, fieldSchema] of Object.entries(configSchema)) {
      const value = config[key];
      if (fieldSchema.type === "secret" && typeof value === "string" && value) {
        if (!foundIds.has(value)) {
          missingSecrets.push(key);
        }
      }
    }
  }

  if (missingSecrets.length > 0) {
    throw Errors.validationError(
      `Config references non-existent secrets: ${missingSecrets.join(", ")}`,
      { missingSecrets },
    );
  }
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
 * Resolve connector config, replacing secret references with decrypted values.
 * Accepts already-fetched connector + catalog to avoid redundant DB queries.
 */
export async function resolveConnectorConfig(
  orgId: string,
  connector: { id: string; config: unknown },
  catalogConfigSchema: unknown,
): Promise<{ resolved: Record<string, string>; missingFields: string[] }> {
  const configSchema = (catalogConfigSchema ?? {}) as Record<
    string,
    { type: string; required?: boolean }
  >;
  const rawConfig = (connector.config ?? {}) as Record<string, unknown>;

  const connectorSecrets = await forOrg(orgId, (tx) =>
    tx
      .select()
      .from(secrets)
      .where(
        and(
          eq(secrets.ownerType, "connector"),
          eq(secrets.ownerId, connector.id),
        ),
      ),
  );
  const secretById = new Map(connectorSecrets.map((s) => [s.id, s]));

  const resolved: Record<string, string> = {};
  const missingFields: string[] = [];

  for (const [key, fieldSchema] of Object.entries(configSchema)) {
    const value = rawConfig[key];

    if (value === undefined || value === null) {
      if (fieldSchema.required) {
        missingFields.push(key);
      }
      continue;
    }

    if (fieldSchema.type === "secret" && typeof value === "string") {
      const secret = secretById.get(value);
      if (secret) {
        try {
          resolved[key] = await decryptSecret(secret.encryptedValue);
        } catch (err) {
          logAndThrow(
            getLogger(),
            err,
            {
              connectorId: connector.id,
              secretId: secret.id,
              secretName: secret.name,
              configField: key,
            },
            "failed to decrypt connector secret",
          );
        }
      } else if (fieldSchema.required) {
        missingFields.push(key);
      }
    } else {
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
