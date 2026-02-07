import { forOrg } from "@db/rls";
import { connectorTools, connectors, secrets } from "@db/schema";
import { listAgentConnectors } from "@features/agents/agents.service";
import { getConnectorManifest } from "@features/connectors/catalog/registry";
import type { ToolExecutionResult } from "@features/connectors/catalog/types";
import {
  getCatalogEntry,
  getConnectorById,
} from "@features/connectors/connectors.service";
import { decryptSecret } from "@lib/crypto";
import { Errors } from "@lib/errors";
import { and, eq, inArray } from "drizzle-orm";
import type { ResolvedTool } from "./mcp.types";

/**
 * Discover all tools available to an agent, resolved with full metadata.
 */
export async function getAgentTools(
  orgId: string,
  agentId: string,
): Promise<ResolvedTool[]> {
  const connectorGroups = await listAgentConnectors(orgId, agentId);

  if (connectorGroups.length === 0) {
    return [];
  }

  const connectorIds = connectorGroups.map((g) => g.connectorId);

  const connectorRows = await forOrg(orgId, (tx) =>
    tx
      .select({
        connectorId: connectors.id,
        catalogId: connectors.connectorCatalogId,
      })
      .from(connectors)
      .where(inArray(connectors.id, connectorIds)),
  );

  const catalogIds = [...new Set(connectorRows.map((r) => r.catalogId))];

  // Fetch catalog entries (no RLS — global table)
  const catalogEntries = await Promise.all(
    catalogIds.map((id) => getCatalogEntry(id)),
  );
  const catalogById = new Map(catalogEntries.map((e) => [e.id, e]));
  const connectorCatalogMap = new Map(
    connectorRows.map((r) => [r.connectorId, catalogById.get(r.catalogId)]),
  );

  const toolRows = await forOrg(orgId, (tx) =>
    tx
      .select()
      .from(connectorTools)
      .where(inArray(connectorTools.connectorId, connectorIds)),
  );

  const toolIndex = new Map<string, (typeof toolRows)[number]>();
  for (const t of toolRows) {
    toolIndex.set(`${t.connectorId}:${t.slug}`, t);
  }

  const resolved: ResolvedTool[] = [];

  for (const group of connectorGroups) {
    const catalog = connectorCatalogMap.get(group.connectorId);
    if (!catalog) continue;

    for (const tool of group.tools) {
      if (!tool.isEnabled) continue;

      const dbTool = toolIndex.get(`${group.connectorId}:${tool.slug}`);
      if (!dbTool || !dbTool.isActive) continue;

      resolved.push({
        mcpName: `${group.connectorSlug}_${tool.slug}`,
        description: dbTool.description ?? "",
        inputSchema: (dbTool.toolSchema as Record<string, unknown>) ?? {},
        requiresConfirmation: tool.requiresConfirmation,
        connectorId: group.connectorId,
        connectorSlug: group.connectorSlug,
        catalogSlug: catalog.slug,
        toolSlug: tool.slug,
        catalogToolName: dbTool.name,
      });
    }
  }

  return resolved;
}

/**
 * Resolve connector config, replacing secret references with decrypted values.
 */
export async function resolveConnectorConfig(
  orgId: string,
  connectorId: string,
): Promise<Record<string, string>> {
  const connector = await getConnectorById(orgId, connectorId);
  const catalog = await getCatalogEntry(connector.connectorCatalogId);

  const configSchema = (catalog.configSchema ?? {}) as Record<
    string,
    { type: string }
  >;
  const rawConfig = (connector.config ?? {}) as Record<string, unknown>;

  const connectorSecrets = await forOrg(orgId, (tx) =>
    tx
      .select()
      .from(secrets)
      .where(
        and(
          eq(secrets.ownerType, "connector"),
          eq(secrets.ownerId, connectorId),
        ),
      ),
  );

  const secretById = new Map(connectorSecrets.map((s) => [s.id, s]));

  const resolved: Record<string, string> = {};

  for (const [key, fieldSchema] of Object.entries(configSchema)) {
    const value = rawConfig[key];
    if (value === undefined || value === null) continue;

    if (fieldSchema.type === "secret" && typeof value === "string") {
      const secret = secretById.get(value);
      if (secret) {
        resolved[key] = await decryptSecret(secret.encryptedValue);
      }
    } else {
      resolved[key] = String(value);
    }
  }

  return resolved;
}

/**
 * Execute a connector tool via its manifest handler.
 */
export async function executeTool(
  orgId: string,
  connectorId: string,
  catalogSlug: string,
  catalogToolName: string,
  config: Record<string, string>,
  input: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  const manifest = getConnectorManifest(catalogSlug);
  if (!manifest) {
    throw Errors.connectorNotFound(catalogSlug);
  }

  const toolDef = manifest.tools.find(
    (t) => t.catalog.name === catalogToolName,
  );
  if (!toolDef) {
    throw Errors.toolNotFound(catalogToolName);
  }

  return toolDef.handler({
    config,
    input,
    organizationId: orgId,
    connectorId,
  });
}
