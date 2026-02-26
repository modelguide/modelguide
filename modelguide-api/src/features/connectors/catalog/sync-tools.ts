/**
 * Idempotent startup sync: propagates new tools from manifests through
 * connectors_catalog → connector_tools → agent_connector_tools.
 *
 * Insert-only — never updates existing rows, preserving org-specific overrides.
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
import { eq, inArray, notInArray } from "drizzle-orm";
import { getAllManifests } from "./registry";

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

/** Derive tool slug from catalog tool name (same logic as createConnector). */
function toolSlug(name: string): string {
  return name.toLowerCase().replace(/\s+/g, "_");
}

/** Sync new tools to existing connector instances and their agent assignments. */
async function syncTools(): Promise<{ tools: number; agentLinks: number }> {
  const manifests = getAllManifests();
  if (manifests.length === 0) return { tools: 0, agentLinks: 0 };

  // Build manifest tool map: catalogSlug → CatalogTool[]
  const manifestToolMap = new Map<string, CatalogTool[]>();
  for (const m of manifests) {
    manifestToolMap.set(
      m.slug,
      m.tools.map((t) => t.catalog),
    );
  }

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

    if (allConnectors.length === 0) return { tools: 0, agentLinks: 0 };

    // 2. Load all existing connector_tools, grouped by connectorId
    const connectorIds = allConnectors.map((c) => c.id);
    const existingTools = await tx
      .select({
        connectorId: connectorTools.connectorId,
        slug: connectorTools.slug,
      })
      .from(connectorTools)
      .where(inArray(connectorTools.connectorId, connectorIds));

    const existingSlugs = new Map<string, Set<string>>();
    for (const row of existingTools) {
      let set = existingSlugs.get(row.connectorId);
      if (!set) {
        set = new Set();
        existingSlugs.set(row.connectorId, set);
      }
      set.add(row.slug);
    }

    // 3. Diff and collect missing connector_tools rows
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

    // Track which connectors got new tools (for agent assignment)
    const affectedConnectorIds = new Set<string>();

    for (const connector of allConnectors) {
      const catalogTools = manifestToolMap.get(connector.catalogSlug);
      if (!catalogTools) continue;

      const existing = existingSlugs.get(connector.id) ?? new Set();

      for (const tool of catalogTools) {
        const slug = toolSlug(tool.name);
        if (!existing.has(slug)) {
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
          affectedConnectorIds.add(connector.id);
        }
      }
    }

    if (missingToolRows.length === 0) return { tools: 0, agentLinks: 0 };

    // 4. Batch insert missing connector_tools
    const insertedTools = await tx
      .insert(connectorTools)
      .values(missingToolRows)
      .onConflictDoNothing()
      .returning({
        id: connectorTools.id,
        connectorId: connectorTools.connectorId,
        slug: connectorTools.slug,
      });

    if (insertedTools.length === 0) return { tools: 0, agentLinks: 0 };

    // 5. For affected connectors, find agents that already have any tool from that connector
    const agentLinks = await findAndLinkAgents(
      tx,
      insertedTools,
      manifestToolMap,
      allConnectors,
    );

    return { tools: insertedTools.length, agentLinks };
  });
}

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
  allConnectors: Array<{
    id: string;
    catalogSlug: string;
  }>,
): Promise<number> {
  // Build connectorId → catalogSlug lookup
  const connectorCatalogSlug = new Map<string, string>();
  for (const c of allConnectors) {
    connectorCatalogSlug.set(c.id, c.catalogSlug);
  }

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
  const existingAssignments = await tx
    .select({
      agentId: agentConnectorTools.agentId,
      connectorId: connectorTools.connectorId,
    })
    .from(agentConnectorTools)
    .innerJoin(
      connectorTools,
      eq(agentConnectorTools.connectorToolId, connectorTools.id),
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

/** Full startup sync: catalog + tools + agent assignments. */
export async function syncCatalogAndTools(): Promise<void> {
  await syncCatalog();
  const { tools, agentLinks } = await syncTools();

  if (tools > 0 || agentLinks > 0) {
    console.log(
      `[sync] Inserted ${tools} new connector_tools, ${agentLinks} new agent assignments`,
    );
  }
}
