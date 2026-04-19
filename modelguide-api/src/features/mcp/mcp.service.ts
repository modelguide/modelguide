import { forOrg } from "@db/rls";
import { agentSops, connectorTools, connectors, sops } from "@db/schema";
import { listAgentConnectors } from "@features/agents/agents.service";
import { trimToShape } from "@features/connectors/catalog/lib/response-trimmer";
import { getConnectorManifest } from "@features/connectors/catalog/registry";
import type { ToolExecutionResult } from "@features/connectors/catalog/types";
import {
  getCatalogEntry,
  getConnectorById,
  resolveConnectorConfig,
} from "@features/connectors/connectors.service";
import {
  updateSession,
  validateActiveSession,
} from "@features/sessions/sessions.service";
import { Errors } from "@lib/errors";
import { getLogger, withTiming } from "@lib/logger";
import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
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
      .where(
        and(
          inArray(connectorTools.connectorId, connectorIds),
          isNull(connectorTools.deletedAt),
        ),
      ),
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
 * Resolve connector config by ID. Fetches connector + catalog, then delegates
 * to the shared resolveConnectorConfig for secret decryption.
 */
export async function resolveConnectorConfigById(
  orgId: string,
  connectorId: string,
): Promise<Record<string, string>> {
  const connector = await getConnectorById(orgId, connectorId);
  const catalog = await getCatalogEntry(connector.connectorCatalogId);

  const { resolved } = await resolveConnectorConfig(
    orgId,
    connector,
    catalog.configSchema,
  );

  return resolved;
}

async function getMockedToolResponse(
  orgId: string,
  connectorId: string,
  catalogToolName: string,
): Promise<Record<string, unknown> | null> {
  const [row] = await forOrg(orgId, (tx) =>
    tx
      .select({ mockResponse: connectorTools.mockResponse })
      .from(connectorTools)
      .where(
        and(
          eq(connectorTools.connectorId, connectorId),
          eq(connectorTools.name, catalogToolName),
          isNotNull(connectorTools.mockResponse),
          isNull(connectorTools.deletedAt),
        ),
      )
      .limit(1),
  );
  return row?.mockResponse ?? null;
}

/**
 * Execute a connector tool via its manifest handler.
 * Falls back to DB mock_response when no TypeScript manifest is registered
 * (used for demo connectors seeded with --mock).
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
    const mockResponse = await getMockedToolResponse(
      orgId,
      connectorId,
      catalogToolName,
    );
    if (mockResponse) {
      return { success: true, data: mockResponse };
    }
    throw Errors.toolExecutionFailed(
      catalogToolName,
      `no manifest registered for "${catalogSlug}" and no mock_response configured on connector_tools`,
    );
  }

  const toolDef = manifest.tools.find(
    (t) => t.catalog.name === catalogToolName,
  );
  if (!toolDef) {
    throw Errors.toolNotFound(catalogToolName);
  }

  const ctx = { tool: catalogToolName, connector: catalogSlug };

  const result = await withTiming(
    getLogger(),
    ctx,
    "tool executed",
    "tool execution failed",
    () =>
      toolDef.handler({ config, input, organizationId: orgId, connectorId }),
  );

  if (toolDef.responseShape && result.success && result.data) {
    result.data =
      (trimToShape(result.data, toolDef.responseShape) as Record<
        string,
        unknown
      >) ?? {};
  }

  return result;
}

/**
 * Resolve all active SOPs assigned to an agent.
 * Returns slug, name, description for each active SOP.
 */
export async function resolveAgentSops(
  orgId: string,
  agentId: string,
): Promise<{ slug: string; name: string; description: string | null }[]> {
  return forOrg(orgId, async (tx) => {
    const rows = await tx
      .select({
        slug: sops.slug,
        name: sops.name,
        description: sops.description,
      })
      .from(agentSops)
      .innerJoin(sops, eq(agentSops.sopId, sops.id))
      .where(and(eq(agentSops.agentId, agentId), eq(sops.status, "active")));

    return rows;
  });
}

// ============================================================================
// SOP classification
// ============================================================================

export interface SopClassification {
  sop_slug: string | null;
  sop_name?: string;
  confidence: number;
  unknown: boolean;
  source?: "agent" | "server";
}

export type ClassifySopResult = {
  session_id: string;
  sop_classification: SopClassification;
};

export type ClassifySopError = {
  error: string;
};

/**
 * Classify a session's SOP — validates the slug against the agent's active SOPs,
 * builds the classification object, and merges it into session metadata.
 *
 * Used by core_classify_sop MCP tool and integration tests.
 */
export async function classifySop(
  orgId: string,
  agentId: string,
  sessionId: string,
  sopSlug: string | null | undefined,
  confidence: number,
): Promise<ClassifySopResult | ClassifySopError> {
  await validateActiveSession(orgId, sessionId, agentId);

  let matchedName: string | undefined;

  if (sopSlug) {
    const agentSopList = await resolveAgentSops(orgId, agentId);
    const match = agentSopList.find((s) => s.slug === sopSlug);

    if (!match) {
      const available = agentSopList.map((s) => s.slug).join(", ");
      return {
        error: `SOP slug "${sopSlug}" is not assigned to this agent. Available slugs: ${available || "(none)"}`,
      };
    }

    matchedName = match.name;
  }

  const sopClassification: SopClassification = {
    sop_slug: sopSlug ?? null,
    ...(matchedName && { sop_name: matchedName }),
    confidence,
    unknown: !sopSlug,
    source: "agent",
  };

  await updateSession(orgId, sessionId, agentId, {
    metadata: { sop_classification: sopClassification },
  });

  return { session_id: sessionId, sop_classification: sopClassification };
}
