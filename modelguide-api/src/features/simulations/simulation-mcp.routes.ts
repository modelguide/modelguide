/**
 * Simulation MCP route — serves mock tools for a simulation session.
 *
 * POST /simulations/:simulationId/mcp
 *
 * Builds mock tools dynamically from the simulation record's mockToolResponses.
 * Production MCP route is unchanged — mocking is entirely isolated here.
 *
 * This is an internal-only route (no external auth). The Mastra agent
 * running inside the same process connects to this URL to call tools.
 */

import type { AppBindings } from "@/types";
import { forApp } from "@db/rls";
import { connectors, connectorsCatalog, sessions } from "@db/schema";
import {
  getConnectorManifest,
  loadAllManifests,
} from "@features/connectors/catalog/registry";
import type { SimulationSessionMetadata } from "@features/evals/eval-suites.types";
import { getAgentTools } from "@features/mcp/mcp.service";
import { createMcpSession } from "@features/mcp/mcp.shared";
import type { McpToolRegistration } from "@features/mcp/mcp.shared";
import { mcpErrorResponse, mcpResponse } from "@features/mcp/mcp.types";
import type { ResolvedTool } from "@features/mcp/mcp.types";
import { jsonSchemaToZod } from "@features/mcp/schema-utils";
import { verifySimulationJWT } from "@lib/jwt";
import { getLogger } from "@lib/logger";
import { toolSlug } from "@lib/slugify";
import { eq } from "drizzle-orm";
import type { Context } from "hono";
import { z } from "zod";

const log = getLogger();

/**
 * Build MCP tool registrations from mockToolResponses + agent tool list.
 *
 * - Configured tools (in mockToolResponses) → return the mock fixture.
 *   Input shape is derived from the real connector tool's JSON schema when
 *   available, so the agent sees production-accurate signatures and calls
 *   tools with realistic args (name/PESEL/card_last4 for verify_customer,
 *   etc.). Falls back to a permissive passthrough if the tool isn't in
 *   the agent's connector set (standalone mock).
 * - Unconfigured agent tools → return "No mock configured for {toolName}" error.
 */
export function buildMockToolsWithFallbacks(
  mockToolResponses: Record<string, unknown>,
  agentTools: ResolvedTool[] = [],
): McpToolRegistration[] {
  const tools: McpToolRegistration[] = [];
  const toolByName = new Map(agentTools.map((t) => [t.mcpName, t]));

  // Permissive fallback: accept any args when no schema is available.
  const passthroughShape = { session_id: z.string().optional() };

  // Configured tools — return fixtures
  for (const [toolName, fixture] of Object.entries(mockToolResponses)) {
    const realTool = toolByName.get(toolName);
    const inputShape = realTool
      ? (() => {
          const shape = jsonSchemaToZod(realTool.inputSchema);
          // Every connector tool gets session_id tacked on by production MCP,
          // mirror that here so the simulation agent's call shape matches prod.
          shape.session_id = z.string().describe("The current session ID");
          return shape;
        })()
      : passthroughShape;

    tools.push({
      name: toolName,
      description: realTool?.description ?? `Mock: ${toolName}`,
      inputShape,
      handler: async () => {
        log.debug({ tool: toolName }, "simulation mock tool called");
        return mcpResponse(fixture as Record<string, unknown>);
      },
    });
  }

  // Unconfigured agent tools — return error. Use real schema so the agent
  // still sees a realistic signature before it learns the mock is absent.
  for (const tool of agentTools) {
    if (!mockToolResponses[tool.mcpName]) {
      const shape = jsonSchemaToZod(tool.inputSchema);
      shape.session_id = z.string().describe("The current session ID");
      tools.push({
        name: tool.mcpName,
        description: tool.description,
        inputShape: shape,
        handler: async () => {
          log.debug({ tool: tool.mcpName }, "unconfigured mock tool called");
          return mcpErrorResponse(
            null,
            `No mock configured for ${tool.mcpName}`,
          );
        },
      });
    }
  }

  return tools;
}

let manifestsLoaded: Promise<unknown> | null = null;
async function ensureManifestsLoaded() {
  manifestsLoaded ??= loadAllManifests();
  return manifestsLoaded;
}

/**
 * Resolve ResolvedTool entries from the in-memory manifest registry for mock
 * tool names that aren't present in the agent's connector_tools DB rows.
 *
 * This handles cases where the connector catalog seed hasn't been applied yet
 * or where a simulation runs against a connector that exists in the manifest
 * registry but isn't wired into the agent's tool list.
 */
async function resolveToolsFromManifests(
  orgId: string,
  toolNames: string[],
): Promise<ResolvedTool[]> {
  const rows = await forApp((tx) =>
    tx
      .select({
        instanceId: connectors.id,
        instanceSlug: connectors.slug,
        catalogSlug: connectorsCatalog.slug,
      })
      .from(connectors)
      .innerJoin(
        connectorsCatalog,
        eq(connectors.connectorCatalogId, connectorsCatalog.id),
      )
      .where(eq(connectors.organizationId, orgId)),
  );

  const slugMap = new Map(
    rows.map((r) => [
      r.instanceSlug,
      { catalogSlug: r.catalogSlug, instanceId: r.instanceId },
    ]),
  );
  await ensureManifestsLoaded();

  const result: ResolvedTool[] = [];
  for (const mcpName of toolNames) {
    for (const [instanceSlug, { catalogSlug, instanceId }] of slugMap) {
      if (!mcpName.startsWith(`${instanceSlug}_`)) continue;
      const manifest = getConnectorManifest(catalogSlug);
      if (!manifest) continue;
      const suffix = mcpName.slice(instanceSlug.length + 1);
      const manifestTool = manifest.tools.find(
        (t) => toolSlug(t.catalog.name) === suffix,
      );
      if (!manifestTool) continue;
      result.push({
        mcpName,
        description: manifestTool.catalog.description,
        inputSchema: manifestTool.catalog.inputSchema as Record<
          string,
          unknown
        >,
        requiresConfirmation:
          manifestTool.catalog.defaultRequiresConfirmation ?? false,
        connectorId: instanceId,
        connectorSlug: instanceSlug,
        catalogSlug,
        toolSlug: suffix,
        catalogToolName: manifestTool.catalog.name,
      });
      break;
    }
  }
  return result;
}

/**
 * Handle simulation MCP requests.
 *
 * Loads the simulation session from DB, builds mock tools from
 * metadata.mockToolResponses, and serves them via the shared MCP handler.
 */
export async function simulationMcpHandler(
  c: Context<AppBindings>,
): Promise<Response> {
  const simulationId = c.req.param("simulationId");

  if (!simulationId) {
    return c.json({ error: "Missing simulationId" }, 400);
  }

  // Verify simulation JWT — reuses existing JWT_SECRET infrastructure
  const authHeader = c.req.header("Authorization");
  const token = authHeader?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) {
    return c.json({ error: "Missing simulation token" }, 401);
  }

  const claims = await verifySimulationJWT(token);
  if (!claims || claims.sessionId !== simulationId) {
    return c.json({ error: "Invalid simulation token" }, 401);
  }

  // Load simulation session with RLS bypass (internal route, authenticated via JWT)
  const [session] = await forApp((tx) =>
    tx
      .select({
        id: sessions.id,
        agentId: sessions.agentId,
        organizationId: sessions.organizationId,
        mode: sessions.mode,
        metadata: sessions.metadata,
      })
      .from(sessions)
      .where(eq(sessions.id, simulationId)),
  );

  if (!session) {
    return c.json(
      { error: `Simulation session "${simulationId}" not found` },
      404,
    );
  }

  if (session.mode !== "simulation") {
    return c.json(
      { error: `Session "${simulationId}" is not a simulation session` },
      400,
    );
  }

  const metadata = (session.metadata ?? {}) as SimulationSessionMetadata;
  const mockToolResponses = metadata.mockToolResponses ?? {};

  // Load agent tools for schema resolution
  const agentTools =
    session.agentId && session.organizationId
      ? await getAgentTools(session.organizationId, session.agentId)
      : [];

  // For mock tools whose schemas aren't in agent_connector_tools (e.g. catalog
  // seed not applied yet), fall back to the in-memory manifest registry.
  const resolvedNames = new Set(agentTools.map((t) => t.mcpName));
  const unmatched = Object.keys(mockToolResponses).filter(
    (n) => !resolvedNames.has(n),
  );
  const fallbackTools =
    unmatched.length > 0 && session.organizationId
      ? await resolveToolsFromManifests(session.organizationId, unmatched)
      : [];

  const mockTools = buildMockToolsWithFallbacks(mockToolResponses, [
    ...agentTools,
    ...fallbackTools,
  ]);

  if (mockTools.length === 0) {
    log.warn(
      { simulationId },
      "simulation MCP route called with no mock tools configured",
    );
  }

  const { handleRequest } = await createMcpSession({
    tools: mockTools,
    serverName: "ModelGuide Simulation MCP",
  });

  return handleRequest(c.req.raw);
}
