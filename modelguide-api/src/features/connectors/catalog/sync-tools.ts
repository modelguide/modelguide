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

  await Promise.all(
    manifests.map((manifest) => {
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

      return db
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
    }),
  );

  if (slugs.length > 0) {
    await db
      .update(connectorsCatalog)
      .set({ isActive: false })
      .where(
        and(
          notInArray(connectorsCatalog.slug, slugs),
          eq(connectorsCatalog.isActive, true),
        ),
      );
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

/** Build slug → CatalogTool lookup for a set of catalog tools. */
function catalogBySlug(tools: CatalogTool[]): Map<string, CatalogTool> {
  return new Map(tools.map((t) => [toolSlug(t.name), t]));
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

  return forApp(async (tx) => {
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

    let inserted = 0;
    let updated = 0;
    let softDeleted = 0;
    let agentLinks = 0;

    const connectorsWithTools = allConnectors.filter((c) =>
      manifestToolMap.has(c.catalogSlug),
    );

    for (const connector of connectorsWithTools) {
      const toolMap = catalogBySlug(
        manifestToolMap.get(connector.catalogSlug)!,
      );

      // Load existing live tools for this connector
      const existing = await tx
        .select({
          id: connectorTools.id,
          slug: connectorTools.slug,
          description: connectorTools.description,
          toolSchema: connectorTools.toolSchema,
        })
        .from(connectorTools)
        .where(
          and(
            eq(connectorTools.connectorId, connector.id),
            isNull(connectorTools.deletedAt),
          ),
        );

      const dbBySlug = new Map(existing.map((r) => [r.slug, r]));

      const inserts: Array<{
        organizationId: string;
        connectorId: string;
        name: string;
        slug: string;
        description: string | null;
        toolSchema: Record<string, unknown>;
        timeoutSeconds: number;
        isActive: true;
      }> = [];

      const updates: Array<{
        id: string;
        description?: string;
        toolSchema?: Record<string, unknown>;
      }> = [];

      for (const [slug, tool] of toolMap) {
        const dbRow = dbBySlug.get(slug);
        if (!dbRow) {
          inserts.push({
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
          const schemaChanged =
            stableStringify(dbRow.toolSchema) !==
            stableStringify(tool.inputSchema);
          const descChanged =
            (dbRow.description ?? "") !== (tool.description ?? "");

          if (schemaChanged || descChanged) {
            const update: (typeof updates)[number] = { id: dbRow.id };
            if (schemaChanged) update.toolSchema = tool.inputSchema;
            if (descChanged) update.description = tool.description;
            updates.push(update);
          }
        }
      }

      // Slugs in DB but not in manifest → soft-delete
      const toDelete = existing
        .filter((r) => !toolMap.has(r.slug))
        .map((r) => r.id);

      // Apply inserts
      if (inserts.length > 0) {
        const rows = await tx
          .insert(connectorTools)
          .values(inserts)
          .onConflictDoNothing()
          .returning({
            id: connectorTools.id,
            slug: connectorTools.slug,
          });
        inserted += rows.length;

        // Auto-assign each new tool to agents already using this connector
        for (const row of rows) {
          agentLinks += await autoAssignTool(
            tx,
            connector.id,
            row.id,
            toolMap.get(row.slug)?.defaultRequiresConfirmation ?? false,
          );
        }
      }

      // Apply updates (preserve isActive, timeoutSeconds)
      await Promise.all(
        updates.map((op) => {
          const setValues: {
            description?: string;
            toolSchema?: Record<string, unknown>;
          } = {};
          if (op.description !== undefined)
            setValues.description = op.description;
          if (op.toolSchema !== undefined) setValues.toolSchema = op.toolSchema;

          return tx
            .update(connectorTools)
            .set(setValues)
            .where(eq(connectorTools.id, op.id));
        }),
      );
      updated += updates.length;

      // Soft-delete removed tools + clean up orphaned agent assignments
      if (toDelete.length > 0) {
        const deleted = await tx
          .update(connectorTools)
          .set({ deletedAt: new Date() })
          .where(inArray(connectorTools.id, toDelete))
          .returning({ id: connectorTools.id });
        softDeleted += deleted.length;

        await tx
          .delete(agentConnectorTools)
          .where(inArray(agentConnectorTools.connectorToolId, toDelete));
      }
    }

    return { inserted, updated, softDeleted, agentLinks };
  });
}

// ============================================================================
// Agent auto-assignment
// ============================================================================

/** Auto-assign a newly inserted tool to agents already using this connector. */
async function autoAssignTool(
  tx: Transaction,
  connectorId: string,
  newToolId: string,
  requiresConfirmation: boolean,
): Promise<number> {
  const agentRows = await tx
    .selectDistinct({ agentId: agentConnectorTools.agentId })
    .from(agentConnectorTools)
    .innerJoin(
      connectorTools,
      and(
        eq(agentConnectorTools.connectorToolId, connectorTools.id),
        isNull(connectorTools.deletedAt),
      ),
    )
    .where(eq(connectorTools.connectorId, connectorId));

  if (agentRows.length === 0) return 0;

  const inserted = await tx
    .insert(agentConnectorTools)
    .values(
      agentRows.map((r) => ({
        agentId: r.agentId,
        connectorToolId: newToolId,
        isEnabled: true,
        requiresConfirmation,
      })),
    )
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
