/**
 * Mastra tool builder — creates stub Tool instances keyed by resolvedName.
 *
 * These are placeholder tools. Consumers replace them with real
 * implementations (MCP toolsets or direct injection at runtime).
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import type { ResolvedTool } from "../../core/types";

/**
 * Build a Record<string, Tool> from the IR's resolved tools.
 *
 * Each tool is a stub with a minimal input schema.
 * Consumers provide actual implementations via MCP toolsets.
 */
export function buildTools(resolvedTools: ResolvedTool[]) {
  // biome-ignore lint/suspicious/noExplicitAny: Mastra tool types are complex
  const tools: Record<string, any> = {};

  for (const rt of resolvedTools) {
    tools[rt.resolvedName] = createTool({
      id: rt.resolvedName,
      description: `Tool: ${rt.resolvedName} (stub — provide implementation via MCP toolset)`,
      inputSchema: z.object({ session_id: z.string() }),
      outputSchema: z.record(z.unknown()),
      execute: async () => {
        throw new Error(
          `Tool "${rt.resolvedName}" is a stub. Provide a real implementation via MCP toolset or direct injection.`,
        );
      },
    });
  }

  return tools;
}
