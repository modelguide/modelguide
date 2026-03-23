/**
 * Unit tests for MCP core tools registration
 */

import { describe, expect, test } from "bun:test";
import { CORE_TOOL_COUNT, registerCoreTools } from "@features/mcp/core-tools";

describe("CORE_TOOL_COUNT", () => {
  test("equals 2", () => {
    expect(CORE_TOOL_COUNT).toBe(2);
  });
});

describe("registerCoreTools", () => {
  /** Captures calls to `server.tool(...)` */
  function createMockServer() {
    const registeredTools: {
      name: string;
      description: string;
      schema: Record<string, unknown>;
    }[] = [];

    const server = {
      tool(
        name: string,
        description: string,
        schema: Record<string, unknown>,
        _handler: (...args: unknown[]) => unknown,
      ) {
        registeredTools.push({ name, description, schema });
      },
    };

    return { server, registeredTools };
  }

  test("registers exactly 2 tools", () => {
    const { server, registeredTools } = createMockServer();
    registerCoreTools(server as never, "org-1", "agent-1");

    expect(registeredTools).toHaveLength(2);
  });

  test("registers all expected tool names", () => {
    const { server, registeredTools } = createMockServer();
    registerCoreTools(server as never, "org-1", "agent-1");

    const names = registeredTools.map((t) => t.name);
    expect(names).toContain("core_add_messages");
    expect(names).toContain("core_classify_sop");
  });

  test("all tools have non-empty descriptions", () => {
    const { server, registeredTools } = createMockServer();
    registerCoreTools(server as never, "org-1", "agent-1");

    for (const tool of registeredTools) {
      expect(tool.description.length).toBeGreaterThan(0);
    }
  });

  test("core_add_messages schema has session_id and messages", () => {
    const { server, registeredTools } = createMockServer();
    registerCoreTools(server as never, "org-1", "agent-1");

    const tool = registeredTools.find((t) => t.name === "core_add_messages")!;
    expect(tool.schema.session_id).toBeDefined();
    expect(tool.schema.messages).toBeDefined();
  });

  test("CORE_TOOL_COUNT matches actual registered count", () => {
    const { server, registeredTools } = createMockServer();
    registerCoreTools(server as never, "org-1", "agent-1");

    expect(registeredTools).toHaveLength(CORE_TOOL_COUNT);
  });
});
