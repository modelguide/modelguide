/**
 * Unit tests for simulation MCP route — buildMockToolsWithFallbacks.
 *
 * Tests that mock tools are correctly built from mockToolResponses:
 * - Registers tools from mockToolResponses keys
 * - Returns fixtures for matching tool names
 * - Returns "No mock configured" error for unconfigured agent tools (AC 4)
 */

import { describe, expect, test } from "bun:test";
import type { ResolvedTool } from "@features/mcp/mcp.types";
import { buildMockToolsWithFallbacks } from "@features/simulations/simulation-mcp.routes";

/** Helper to build a minimal ResolvedTool stub for tests. */
function stubResolvedTool(
  mcpName: string,
  description: string,
  inputSchema: Record<string, unknown> = {
    type: "object",
    properties: {},
  },
): ResolvedTool {
  return {
    mcpName,
    description,
    inputSchema,
    requiresConfirmation: false,
    connectorId: "conn-test",
    connectorSlug: "test_conn",
    catalogSlug: "test",
    toolSlug: mcpName.replace(/^[^_]+_/, ""),
    catalogToolName: mcpName,
  };
}

describe("buildMockToolsWithFallbacks", () => {
  test("creates tool registrations from mockToolResponses", () => {
    const mockResponses = {
      wf_store_look_up_order: {
        order_id: "ORD-123",
        status: "shipped",
        shipping_date: "2026-03-20",
      },
      wf_helpdesk_create_ticket: {
        ticket_id: "TKT-456",
        status: "created",
      },
    };

    const tools = buildMockToolsWithFallbacks(mockResponses);

    expect(tools).toHaveLength(2);
    expect(tools[0].name).toBe("wf_store_look_up_order");
    expect(tools[0].description).toBe("Mock: wf_store_look_up_order");
    expect(tools[1].name).toBe("wf_helpdesk_create_ticket");
    expect(tools[1].description).toBe("Mock: wf_helpdesk_create_ticket");
  });

  test("tool handler returns the configured fixture", async () => {
    const fixture = {
      order_id: "ORD-123",
      status: "delivered",
      delivered_at: "2026-03-15",
    };

    const tools = buildMockToolsWithFallbacks({ my_tool: fixture });

    expect(tools).toHaveLength(1);
    const result = await tools[0].handler({});
    // mcpResponse wraps the data in MCP content format
    expect(result).toBeDefined();
    expect(result.content).toBeDefined();
    expect(result.content[0].type).toBe("text");
    // The fixture should be JSON-encoded in the text content
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.order_id).toBe("ORD-123");
    expect(parsed.status).toBe("delivered");
  });

  test("empty mockToolResponses with no agent tools returns empty array", () => {
    const tools = buildMockToolsWithFallbacks({});
    expect(tools).toHaveLength(0);
  });

  test("each tool has a session_id input shape", () => {
    const tools = buildMockToolsWithFallbacks({ my_tool: { data: true } });
    expect(tools[0].inputShape).toBeDefined();
    expect(tools[0].inputShape.session_id).toBeDefined();
  });

  test("unconfigured agent tools return error response (AC 4)", async () => {
    const mockResponses = {
      wf_store_look_up_order: { order_id: "ORD-123", status: "shipped" },
    };
    const agentTools = [
      stubResolvedTool("wf_store_look_up_order", "Look up order"),
      stubResolvedTool("wf_helpdesk_create_ticket", "Create ticket"),
    ];

    const tools = buildMockToolsWithFallbacks(mockResponses, agentTools);

    // 1 configured + 1 unconfigured = 2 tools
    expect(tools).toHaveLength(2);
    expect(tools[0].name).toBe("wf_store_look_up_order");
    expect(tools[1].name).toBe("wf_helpdesk_create_ticket");

    // Configured tool returns fixture
    const configuredResult = await tools[0].handler({});
    const parsed = JSON.parse(configuredResult.content[0].text);
    expect(parsed.order_id).toBe("ORD-123");

    // Unconfigured tool returns error
    const unconfiguredResult = await tools[1].handler({});
    expect(unconfiguredResult.isError).toBe(true);
    expect(unconfiguredResult.content[0].text).toContain(
      "No mock configured for wf_helpdesk_create_ticket",
    );
  });

  test("all agent tools configured means no fallback registrations", () => {
    const mockResponses = {
      tool_a: { result: "a" },
      tool_b: { result: "b" },
    };
    const agentTools = [
      stubResolvedTool("tool_a", "Tool A"),
      stubResolvedTool("tool_b", "Tool B"),
    ];

    const tools = buildMockToolsWithFallbacks(mockResponses, agentTools);
    expect(tools).toHaveLength(2);
    // Both should be configured — description mirrors the real tool when
    // available instead of falling back to the "Mock:" prefix.
    expect(tools[0].description).toBe("Tool A");
    expect(tools[1].description).toBe("Tool B");
  });
});
