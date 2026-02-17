import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { McpTool, OpenAIFunction, ToolResult } from "../types.js";

interface McpClientConfig {
  baseUrl: string;
  agentId: string;
  apiKey: string;
}

export class EvalMcpClient {
  private client: Client;
  private transport: StreamableHTTPClientTransport;

  constructor(config: McpClientConfig) {
    this.transport = new StreamableHTTPClientTransport(
      new URL(`${config.baseUrl}/mcp/${config.agentId}`),
      {
        requestInit: {
          headers: { Authorization: `Bearer ${config.apiKey}` },
        },
      },
    );
    this.client = new Client({
      name: "modelguide-eval",
      version: "1.0.0",
    });
  }

  async connect(): Promise<void> {
    await this.client.connect(this.transport);
  }

  async discoverTools(): Promise<McpTool[]> {
    const result = await this.client.listTools();
    return result.tools.map((t) => ({
      name: t.name,
      description: t.description ?? "",
      inputSchema: t.inputSchema as McpTool["inputSchema"],
    }));
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<ToolResult> {
    const result = await this.client.callTool({ name, arguments: args });

    if (result.content && Array.isArray(result.content)) {
      const textContent = (
        result.content as Array<{ type: string; text?: string }>
      ).find((c) => c.type === "text");
      if (textContent?.text) {
        try {
          return JSON.parse(textContent.text) as ToolResult;
        } catch {
          return { success: true, data: textContent.text };
        }
      }
    }

    return { success: false, error: "No text content in tool result" };
  }

  async close(): Promise<void> {
    await this.transport.close();
  }
}

/**
 * Convert MCP tools to OpenAI function-calling format.
 * Strips session_id from parameters (orchestrator injects it).
 */
export function toOpenAIFunctions(tools: McpTool[]): OpenAIFunction[] {
  return tools.map((tool) => {
    const properties = { ...tool.inputSchema.properties };
    const required = (tool.inputSchema.required ?? []).filter(
      (r) => r !== "session_id",
    );

    properties.session_id = undefined;

    return {
      type: "function" as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: {
          type: "object",
          properties,
          required: required.length > 0 ? required : undefined,
        },
      },
    };
  });
}
