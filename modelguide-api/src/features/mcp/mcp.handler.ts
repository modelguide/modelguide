/**
 * MCP request handler -- creates a per-request McpServer, registers tools/resources,
 * and delegates to the Streamable HTTP transport.
 */

import type { AppBindings } from "@/types";
import { Errors } from "@lib/errors";
import {
  McpServer,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { Context } from "hono";
import { z } from "zod";
import {
  CONFIRMATION_TTL_SECONDS,
  consumeConfirmation,
  createConfirmation,
} from "./confirmation.service";
import { CORE_TOOL_COUNT, registerCoreTools } from "./core-tools";
import {
  executeTool,
  getAgentTools,
  resolveConnectorConfig,
} from "./mcp.service";
import { type ResolvedTool, mcpResponse } from "./mcp.types";
import { jsonSchemaToZod } from "./schema-utils";

export async function mcpHandler(c: Context<AppBindings>): Promise<Response> {
  const auth = c.get("auth");

  if (auth.type !== "agent") {
    throw Errors.unauthorized("Agent authentication required");
  }

  if (!auth.agent.isActive) {
    throw Errors.agentInactive(auth.agent.id);
  }

  const orgId = auth.agent.organizationId;
  const agentId = auth.agent.id;

  const tools = await getAgentTools(orgId, agentId);

  const server = new McpServer(
    { name: "ModelGuide MCP", version: "1.0.0" },
    { capabilities: { logging: {} } },
  );

  registerResources(server, auth.agent, tools);
  registerCoreTools(server, orgId, agentId);
  registerConnectorTools(server, orgId, agentId, tools);

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
    agentType: string;
  },
  tools: ResolvedTool[],
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
          agent_type: agent.agentType,
          tool_count: tools.length + CORE_TOOL_COUNT,
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

    if (tool.requiresConfirmation) {
      zodShape._confirmation_id = z
        .string()
        .optional()
        .describe(
          "Confirmation ID from a previous confirmation_required response",
        );
    }

    server.tool(tool.mcpName, tool.description, zodShape, async (args) => {
      try {
        if (tool.requiresConfirmation) {
          const confirmationId = args._confirmation_id as string | undefined;

          if (!confirmationId) {
            const confirmation = await createConfirmation(orgId, {
              agentId,
              connectorId: tool.connectorId,
              mcpToolName: tool.mcpName,
              args: args as Record<string, unknown>,
            });

            return mcpResponse({
              status: "confirmation_required",
              confirmation_id: confirmation.id,
              tool_name: tool.mcpName,
              message: `This action requires confirmation. Re-call this tool with _confirmation_id: "${confirmation.id}" to proceed.`,
              expires_in_seconds: CONFIRMATION_TTL_SECONDS,
            });
          }

          const consumed = await consumeConfirmation(
            orgId,
            confirmationId,
            tool.mcpName,
            agentId,
          );

          if (!consumed) {
            return mcpResponse(
              {
                error: "Confirmation invalid, expired, or already consumed.",
                tool_name: tool.mcpName,
              },
              true,
            );
          }
        }

        const { _confirmation_id: _, ...toolInput } = args as Record<
          string,
          unknown
        >;

        const config = await resolveConnectorConfig(orgId, tool.connectorId);
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
        const message =
          err instanceof Error ? err.message : "Tool execution failed";
        return mcpResponse({ error: message, tool_name: tool.mcpName }, true);
      }
    });
  }
}
