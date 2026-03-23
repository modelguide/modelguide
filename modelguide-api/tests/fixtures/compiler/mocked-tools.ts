/**
 * Mocked MCP tools for deterministic eval testing.
 *
 * Both hand-built and compiled agents use these same mocks
 * to ensure a fair comparison. Tool responses are deterministic
 * fixtures — the LLM is real, only tool I/O is mocked.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { mockedToolResponses } from "./test-emails";

/**
 * Create mocked tools that return deterministic responses.
 * These replace real MCP tools during eval runs.
 */
export function createMockedTools() {
  return {
    store_look_up_order: createTool({
      id: "store_look_up_order",
      description: "Look up an order by order number and customer email",
      inputSchema: z.object({
        session_id: z.string().optional(),
        order_number: z.union([z.string(), z.number()]).optional(),
        customer_email: z.string().optional(),
        email: z.string().optional(),
      }),
      outputSchema: z.record(z.unknown()),
      execute: async () => {
        return mockedToolResponses.store_look_up_order as Record<
          string,
          unknown
        >;
      },
    }),

    helpdesk_create_ticket: createTool({
      id: "helpdesk_create_ticket",
      description: "Create a helpdesk support ticket",
      inputSchema: z.object({
        session_id: z.string().optional(),
        subject: z.string().optional(),
        body: z.string().optional(),
        requesterEmail: z.string().optional(),
        tags: z.array(z.string()).optional(),
        priority: z.string().optional(),
      }),
      outputSchema: z.record(z.unknown()),
      execute: async () => {
        return mockedToolResponses.helpdesk_create_ticket as Record<
          string,
          unknown
        >;
      },
    }),
  };
}

/**
 * Create a toolsets-compatible object matching the shape
 * returned by MCPClient.listToolsets().
 */
export function createMockedToolsets() {
  const tools = createMockedTools();
  return {
    modelguide: tools,
  };
}
