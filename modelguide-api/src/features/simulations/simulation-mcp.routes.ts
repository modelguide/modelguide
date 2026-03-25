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
import { sessions } from "@db/schema";
import type { SimulationSessionMetadata } from "@features/evals/eval-suites.types";
import { getAgentTools } from "@features/mcp/mcp.service";
import { createMcpSession } from "@features/mcp/mcp.shared";
import type { McpToolRegistration } from "@features/mcp/mcp.shared";
import { mcpErrorResponse, mcpResponse } from "@features/mcp/mcp.types";
import { verifySimulationJWT } from "@lib/jwt";
import { getLogger } from "@lib/logger";
import { eq } from "drizzle-orm";
import type { Context } from "hono";
import { z } from "zod";

const log = getLogger();

/**
 * Build MCP tool registrations from mockToolResponses + agent tool list.
 *
 * - Configured tools (in mockToolResponses) → return the mock fixture
 * - Unconfigured tools (in agentTools but not mockToolResponses) → return
 *   "No mock configured for {toolName}" error (AC 4)
 */
export function buildMockToolsWithFallbacks(
  mockToolResponses: Record<string, unknown>,
  agentTools: Array<{ mcpName: string; description: string }> = [],
): McpToolRegistration[] {
  const tools: McpToolRegistration[] = [];

  // Configured tools — return fixtures
  for (const [toolName, fixture] of Object.entries(mockToolResponses)) {
    tools.push({
      name: toolName,
      description: `Mock: ${toolName}`,
      inputShape: { session_id: z.string().optional() },
      handler: async () => {
        log.debug({ tool: toolName }, "simulation mock tool called");
        return mcpResponse(fixture as Record<string, unknown>);
      },
    });
  }

  // Unconfigured agent tools — return error
  for (const tool of agentTools) {
    if (!mockToolResponses[tool.mcpName]) {
      tools.push({
        name: tool.mcpName,
        description: tool.description,
        inputShape: { session_id: z.string().optional() },
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

  // Load agent tools for fallback registration (AC 4)
  const agentTools =
    session.agentId && session.organizationId
      ? await getAgentTools(session.organizationId, session.agentId)
      : [];

  const mockTools = buildMockToolsWithFallbacks(
    mockToolResponses,
    agentTools.map((t) => ({ mcpName: t.mcpName, description: t.description })),
  );

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
