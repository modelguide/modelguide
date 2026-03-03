/**
 * MCP request handler -- creates a per-request McpServer, registers tools/resources,
 * and delegates to the Streamable HTTP transport.
 */

import type { AppBindings } from "@/types";
import { validateActiveSession } from "@features/sessions";
import { Errors } from "@lib/errors";
import { getLogger } from "@lib/logger";
import {
  McpServer,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { Context } from "hono";
import { z } from "zod";
import { CORE_TOOL_COUNT, registerCoreTools } from "./core-tools";
import {
  executeTool,
  getAgentTools,
  resolveConnectorConfigById,
} from "./mcp.service";
import { type ResolvedTool, mcpErrorResponse, mcpResponse } from "./mcp.types";
import { jsonSchemaToZod } from "./schema-utils";

export async function mcpHandler(c: Context<AppBindings>): Promise<Response> {
  const auth = c.get("auth");

  if (auth.type !== "agent") {
    throw Errors.unauthorized("Agent authentication required");
  }

  if (!auth.agent.isActive) {
    throw Errors.agentInactive(auth.agent.id);
  }

  const pathAgentId = c.req.param("agentId");
  if (pathAgentId && pathAgentId !== auth.agent.id) {
    throw Errors.unauthorized("API key does not match agent ID in URL");
  }

  const orgId = auth.agent.organizationId;
  const agentId = auth.agent.id;

  const tools = await getAgentTools(orgId, agentId);

  const enableCoreAddMessages =
    auth.agent.metadata?.enableCoreAddMessages === true;

  const server = new McpServer(
    { name: "ModelGuide MCP", version: "1.0.0" },
    { capabilities: { logging: {} } },
  );

  const coreToolCount = enableCoreAddMessages ? CORE_TOOL_COUNT : 0;
  registerResources(server, auth.agent, tools, coreToolCount);
  if (enableCoreAddMessages) {
    registerCoreTools(server, orgId, agentId);
  }
  registerConnectorTools(server, orgId, agentId, tools);

  getLogger().info(
    { agentId, connectorTools: tools.length, coreTools: coreToolCount },
    "MCP server initialized",
  );

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  await server.connect(transport);

  return transport.handleRequest(c.req.raw);
}

function registerResources(
  server: McpServer,
  agent: {
    id: string;
    name: string;
    organizationId: string;
    modality: string;
  },
  tools: ResolvedTool[],
  coreToolCount: number,
): void {
  server.resource("agent-config", "agent://config", async () => ({
    contents: [
      {
        uri: "agent://config",
        mimeType: "application/json",
        text: JSON.stringify({
          agent_id: agent.id,
          agent_name: agent.name,
          organization_id: agent.organizationId,
          modality: agent.modality,
          tool_count: tools.length + coreToolCount,
        }),
      },
    ],
  }));

  server.resource("tools-list", "tools://list", async () => ({
    contents: [
      {
        uri: "tools://list",
        mimeType: "application/json",
        text: JSON.stringify(
          tools.map((t) => ({
            name: t.mcpName,
            connector: t.connectorSlug,
            description: t.description,
            requires_confirmation: t.requiresConfirmation,
          })),
        ),
      },
    ],
  }));

  server.resource(
    "tool-detail",
    new ResourceTemplate("tools://{tool_name}", { list: undefined }),
    async (uri, { tool_name }) => {
      const tool = tools.find((t) => t.mcpName === tool_name);
      if (!tool) {
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "application/json",
              text: JSON.stringify({ error: `Tool not found: ${tool_name}` }),
            },
          ],
        };
      }

      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify({
              name: tool.mcpName,
              connector: tool.connectorSlug,
              catalog_slug: tool.catalogSlug,
              description: tool.description,
              requires_confirmation: tool.requiresConfirmation,
              input_schema: tool.inputSchema,
            }),
          },
        ],
      };
    },
  );
}

function registerConnectorTools(
  server: McpServer,
  orgId: string,
  agentId: string,
  tools: ResolvedTool[],
): void {
  for (const tool of tools) {
    const zodShape = jsonSchemaToZod(tool.inputSchema);

    // Every connector tool requires an active session
    zodShape.session_id = z.string().describe("The current session ID");

    server.tool(tool.mcpName, tool.description, zodShape, async (args) => {
      try {
        const { session_id, ...toolInput } = args as Record<string, unknown>;
        const sessionId = session_id as string;

        await validateActiveSession(orgId, sessionId, agentId);

        const config = await resolveConnectorConfigById(
          orgId,
          tool.connectorId,
        );
        const result = await executeTool(
          orgId,
          tool.connectorId,
          tool.catalogSlug,
          tool.catalogToolName,
          config,
          toolInput,
        );

        return mcpResponse(result as unknown as Record<string, unknown>);
      } catch (err) {
        return mcpErrorResponse(err, "Tool execution failed", {
          tool_name: tool.mcpName,
        });
      }
    });
  }
}
