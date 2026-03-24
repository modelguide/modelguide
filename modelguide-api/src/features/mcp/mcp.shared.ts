/**
 * Shared MCP server creation — used by both the production MCP handler
 * and the simulation MCP route.
 *
 * Extracts server instantiation, transport wiring, and request handling
 * so both routes share the same MCP protocol logic.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

export interface McpToolRegistration {
  name: string;
  description: string;
  /** Zod shape for tool.inputSchema */
  // biome-ignore lint/suspicious/noExplicitAny: MCP SDK accepts Record<string, ZodType>
  inputShape: Record<string, any>;
  /** Handler invoked when the tool is called */
  // biome-ignore lint/suspicious/noExplicitAny: MCP SDK handler signature
  handler: (args: Record<string, unknown>) => Promise<any>;
}

/**
 * Create an McpServer, run an optional setup callback for custom registration
 * (resources, tools, etc.), then connect via Streamable HTTP transport.
 *
 * Two usage patterns:
 * - Simple: pass `tools` array for automatic registration
 * - Advanced: pass `setup` callback for full control (resources, core tools, etc.)
 */
export async function createMcpSession(opts: {
  tools?: McpToolRegistration[];
  setup?: (server: McpServer) => void;
  serverName?: string;
  serverVersion?: string;
}): Promise<{
  server: McpServer;
  handleRequest: (request: Request) => Promise<Response>;
}> {
  const server = new McpServer(
    {
      name: opts.serverName ?? "ModelGuide MCP",
      version: opts.serverVersion ?? "1.0.0",
    },
    { capabilities: { logging: {} } },
  );

  if (opts.setup) {
    opts.setup(server);
  }

  if (opts.tools) {
    for (const tool of opts.tools) {
      server.tool(tool.name, tool.description, tool.inputShape, tool.handler);
    }
  }

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  await server.connect(transport);

  return {
    server,
    handleRequest: (request: Request) => transport.handleRequest(request),
  };
}
