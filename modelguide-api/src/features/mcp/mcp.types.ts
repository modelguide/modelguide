import { isAppError } from "@lib/errors";

export interface ResolvedTool {
  /** MCP tool name: "{connectorSlug}_{toolSlug}" */
  mcpName: string;
  description: string;
  /** JSON Schema from connector_tools.toolSchema */
  inputSchema: Record<string, unknown>;
  requiresConfirmation: boolean;
  connectorId: string;
  connectorSlug: string;
  /** From connectors_catalog.slug (for manifest lookup) */
  catalogSlug: string;
  /** From connector_tools.slug */
  toolSlug: string;
  /** From connector_tools.name (matches manifest tool.catalog.name) */
  catalogToolName: string;
}

export interface McpToolResponse {
  [key: string]: unknown;
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

/**
 * Build a standard MCP tool response by JSON-serializing the given data.
 */
export function mcpResponse(
  data: Record<string, unknown>,
  isError = false,
): McpToolResponse {
  const response: McpToolResponse = {
    content: [{ type: "text", text: JSON.stringify(data) }],
  };
  if (isError) {
    response.isError = true;
  }
  return response;
}

/**
 * Build an MCP error response from a caught exception.
 * Only exposes messages from known AppErrors; raw Drizzle/Postgres errors use the fallback.
 */
export function mcpErrorResponse(
  err: unknown,
  fallback: string,
  extra?: Record<string, unknown>,
): McpToolResponse {
  const message = isAppError(err) ? err.message : fallback;
  return mcpResponse({ error: message, ...extra }, true);
}
