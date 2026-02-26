/**
 * Idempotent startup sync: propagates tool changes from manifests through
 * connectors_catalog → connector_tools → agent_connector_tools.
 *
 * Full lifecycle: inserts new tools, updates stale schema/description,
 * soft-deletes removed tools, and cleans up orphaned agent assignments.
 */

import { db } from "@db/client";
import { forApp } from "@db/rls";
import type { Transaction } from "@db/rls";
import {
  agentConnectorTools,
  connectorTools,
  connectors,
  connectorsCatalog,
} from "@db/schema";
import type { CatalogTool, NewConnectorCatalog } from "@db/schema";
import { stableStringify } from "@lib/json";
import { toolSlug } from "@lib/slugify";
import { and, eq, inArray, isNull, notInArray } from "drizzle-orm";
import { getAllManifests } from "./registry";

// ============================================================================
// Catalog sync
// ============================================================================

/** Upsert manifests into connectors_catalog, deactivate removed ones. */
async function syncCatalog(): Promise<void> {
  const manifests = getAllManifests();
  const slugs = manifests.map((m) => m.slug);

  for (const manifest of manifests) {
    const row: NewConnectorCatalog = {
      name: manifest.name,
      slug: manifest.slug,
      description: manifest.description,
      connectorType: manifest.connectorType,
      configSchema: manifest.configSchema,
      tools: manifest.tools.map((t) => t.catalog),
      authMethods: manifest.authMethods,
      iconUrl: manifest.iconUrl,
      isActive: true,
    };

    await db
      .insert(connectorsCatalog)
      .values(row)
      .onConflictDoUpdate({
        target: connectorsCatalog.slug,
        set: {
          name: row.name,
          description: row.description,
          connectorType: row.connectorType,
          configSchema: row.configSchema,
          tools: row.tools,
          authMethods: row.authMethods,
          iconUrl: row.iconUrl,
          isActive: true,
        },
      });
  }

  if (slugs.length > 0) {
    await db
      .update(connectorsCatalog)
      .set({ isActive: false })
      .where(notInArray(connectorsCatalog.slug, slugs));
  }
}

// ============================================================================
// Tool sync (full lifecycle)
// ============================================================================

interface SyncResult {
  inserted: number;
  updated: number;
  softDeleted: number;
  agentLinks: number;
}

/** Sync tools to existing connector instances: insert, update, soft-delete. */
async function syncTools(): Promise<SyncResult> {
  const manifests = getAllManifests();
  if (manifests.length === 0)
    return { inserted: 0, updated: 0, softDeleted: 0, agentLinks: 0 };

  // Build manifest tool map: catalogSlug → CatalogTool[]
  const manifestToolMap = new Map<string, CatalogTool[]>();
  for (const m of manifests) {
    manifestToolMap.set(
      m.slug,
      m.tools.map((t) => t.catalog),
    );
  }

  // Single transaction for atomicity. If connector/org count grows significantly,
  // consider chunking per connector to reduce lock duration during startup.
  return forApp(async (tx) => {
    // 1. Load all active connectors with their catalog slug
    const allConnectors = await tx
      .select({
        id: connectors.id,
        organizationId: connectors.organizationId,
        catalogSlug: connectorsCatalog.slug,
      })
      .from(connectors)
      .innerJoin(
        connectorsCatalog,
        eq(connectors.connectorCatalogId, connectorsCatalog.id),
      )
      .where(eq(connectors.isActive, true));

    if (allConnectors.length === 0)
      return { inserted: 0, updated: 0, softDeleted: 0, agentLinks: 0 };

    // 2. Load all existing live (non-deleted) connector_tools
    const connectorIds = allConnectors.map((c) => c.id);
    const existingTools = await tx
      .select({
        id: connectorTools.id,
        connectorId: connectorTools.connectorId,
        slug: connectorTools.slug,
        description: connectorTools.description,
        toolSchema: connectorTools.toolSchema,
      })
      .from(connectorTools)
      .where(
        and(
          inArray(connectorTools.connectorId, connectorIds),
          isNull(connectorTools.deletedAt),
        ),
      );

    // Group existing tools by connectorId → slug → row
    const existingByConnector = new Map<
      string,
      Map<string, (typeof existingTools)[number]>
    >();
    for (const row of existingTools) {
      let map = existingByConnector.get(row.connectorId);
      if (!map) {
        map = new Map();
        existingByConnector.set(row.connectorId, map);
      }
      map.set(row.slug, row);
    }

    // 3. Diff: collect inserts, updates, and soft-deletes
    const missingToolRows: Array<{
      organizationId: string;
      connectorId: string;
      name: string;
      slug: string;
      description: string | null;
      toolSchema: Record<string, unknown>;
      timeoutSeconds: number;
      isActive: true;
    }> = [];

    const updateOps: Array<{
      id: string;
      description?: string;
      toolSchema?: Record<string, unknown>;
    }> = [];

    // Track tool IDs to soft-delete per connector
    const toolIdsToDelete: string[] = [];

    for (const connector of allConnectors) {
      const catalogTools = manifestToolMap.get(connector.catalogSlug);
      if (!catalogTools) continue;

      const existing = existingByConnector.get(connector.id) ?? new Map();
      const manifestSlugs = new Set<string>();

      for (const tool of catalogTools) {
        const slug = toolSlug(tool.name);
        manifestSlugs.add(slug);

        const dbRow = existing.get(slug);
        if (!dbRow) {
          // New tool → INSERT
          missingToolRows.push({
            organizationId: connector.organizationId,
            connectorId: connector.id,
            name: tool.name,
            slug,
            description: tool.description,
            toolSchema: tool.inputSchema,
            timeoutSeconds: tool.defaultTimeoutSeconds,
            isActive: true,
          });
        } else {
          // Existing tool — check for schema/description drift
          const schemaChanged =
            stableStringify(dbRow.toolSchema) !==
            stableStringify(tool.inputSchema);
          const descChanged =
            (dbRow.description ?? "") !== (tool.description ?? "");

          if (schemaChanged || descChanged) {
            const update: (typeof updateOps)[number] = { id: dbRow.id };
            if (schemaChanged) update.toolSchema = tool.inputSchema;
            if (descChanged) update.description = tool.description;
            updateOps.push(update);
          }
        }
      }

      // Tools in DB but not in manifest → soft-delete
      for (const [slug, dbRow] of existing) {
        if (!manifestSlugs.has(slug)) {
          toolIdsToDelete.push(dbRow.id);
        }
      }
    }

    let insertedCount = 0;
    let updatedCount = 0;
    let softDeletedCount = 0;

    // 4. Batch insert new tools
    let insertedTools: Array<{
      id: string;
      connectorId: string;
      slug: string;
    }> = [];

    if (missingToolRows.length > 0) {
      insertedTools = await tx
        .insert(connectorTools)
        .values(missingToolRows)
        .onConflictDoNothing()
        .returning({
          id: connectorTools.id,
          connectorId: connectorTools.connectorId,
          slug: connectorTools.slug,
        });
      insertedCount = insertedTools.length;
    }

    // 5. Apply updates (preserve isActive, timeoutSeconds)
    // TODO: batch into a single SQL statement (e.g. VALUES list + UPDATE FROM)
    // if connector/org count grows enough for per-row updates to be slow.
    for (const op of updateOps) {
      const setValues: {
        description?: string;
        toolSchema?: Record<string, unknown>;
      } = {};
      if (op.description !== undefined) setValues.description = op.description;
      if (op.toolSchema !== undefined) setValues.toolSchema = op.toolSchema;

      await tx
        .update(connectorTools)
        .set(setValues)
        .where(eq(connectorTools.id, op.id));
      updatedCount++;
    }

    // 6. Soft-delete removed tools + clean up orphaned agent assignments
    if (toolIdsToDelete.length > 0) {
      const deleted = await tx
        .update(connectorTools)
        .set({ deletedAt: new Date() })
        .where(inArray(connectorTools.id, toolIdsToDelete))
        .returning({ id: connectorTools.id });
      softDeletedCount = deleted.length;

      // Hard-delete orphaned agent_connector_tools (ON DELETE CASCADE
      // does not fire for soft deletes)
      if (softDeletedCount > 0) {
        await tx
          .delete(agentConnectorTools)
          .where(inArray(agentConnectorTools.connectorToolId, toolIdsToDelete));
      }
    }

    // 7. Auto-assign newly inserted tools to agents using the connector
    let agentLinks = 0;
    if (insertedTools.length > 0) {
      agentLinks = await findAndLinkAgents(tx, insertedTools, manifestToolMap);
    }

    return {
      inserted: insertedCount,
      updated: updatedCount,
      softDeleted: softDeletedCount,
      agentLinks,
    };
  });
}

// ============================================================================
// Agent auto-assignment
// ============================================================================

/**
 * For each newly inserted connector_tool, find agents that already use
 * other tools from the same connector and auto-assign the new tool.
 */
async function findAndLinkAgents(
  tx: Transaction,
  insertedTools: Array<{
    id: string;
    connectorId: string;
    slug: string;
  }>,
  manifestToolMap: Map<string, CatalogTool[]>,
): Promise<number> {
  // Build tool slug → defaultRequiresConfirmation lookup
  const confirmationDefaults = new Map<string, boolean>();
  for (const [, tools] of manifestToolMap) {
    for (const tool of tools) {
      confirmationDefaults.set(
        toolSlug(tool.name),
        tool.defaultRequiresConfirmation,
      );
    }
  }

  // Group inserted tools by connectorId
  const toolsByConnector = new Map<
    string,
    Array<{ id: string; slug: string }>
  >();
  for (const tool of insertedTools) {
    let arr = toolsByConnector.get(tool.connectorId);
    if (!arr) {
      arr = [];
      toolsByConnector.set(tool.connectorId, arr);
    }
    arr.push(tool);
  }

  const affectedConnectorIds = [...toolsByConnector.keys()];

  // Find existing agent assignments for tools belonging to affected connectors
  // Exclude soft-deleted tools so we only match live assignments
  const existingAssignments = await tx
    .select({
      agentId: agentConnectorTools.agentId,
      connectorId: connectorTools.connectorId,
    })
    .from(agentConnectorTools)
    .innerJoin(
      connectorTools,
      and(
        eq(agentConnectorTools.connectorToolId, connectorTools.id),
        isNull(connectorTools.deletedAt),
      ),
    )
    .where(inArray(connectorTools.connectorId, affectedConnectorIds));

  // Build connectorId → Set<agentId>
  const agentsByConnector = new Map<string, Set<string>>();
  for (const row of existingAssignments) {
    let set = agentsByConnector.get(row.connectorId);
    if (!set) {
      set = new Set();
      agentsByConnector.set(row.connectorId, set);
    }
    set.add(row.agentId);
  }

  // Build agent_connector_tools insert values
  const linkValues: Array<{
    agentId: string;
    connectorToolId: string;
    isEnabled: boolean;
    requiresConfirmation: boolean;
  }> = [];

  for (const [connectorId, newTools] of toolsByConnector) {
    const agentIds = agentsByConnector.get(connectorId);
    if (!agentIds || agentIds.size === 0) continue;

    for (const agentId of agentIds) {
      for (const tool of newTools) {
        linkValues.push({
          agentId,
          connectorToolId: tool.id,
          isEnabled: true,
          requiresConfirmation: confirmationDefaults.get(tool.slug) ?? false,
        });
      }
    }
  }

  if (linkValues.length === 0) return 0;

  const inserted = await tx
    .insert(agentConnectorTools)
    .values(linkValues)
    .onConflictDoNothing()
    .returning({ id: agentConnectorTools.id });

  return inserted.length;
}

// ============================================================================
// Public entry point
// ============================================================================

/** Full startup sync: catalog + tools + agent assignments. */
export async function syncCatalogAndTools(): Promise<void> {
  await syncCatalog();
  const { inserted, updated, softDeleted, agentLinks } = await syncTools();

  if (inserted > 0 || updated > 0 || softDeleted > 0 || agentLinks > 0) {
    console.log(
      `[sync] +${inserted} inserted, ~${updated} updated, -${softDeleted} soft-deleted; ${agentLinks} agent assignments`,
    );
  }
}
