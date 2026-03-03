/**
 * Core MCP tools — platform tools registered on every MCP server instance.
 */

import { addMessages } from "@features/sessions";
import { enrichLogger, getLogger } from "@lib/logger";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { mcpErrorResponse, mcpResponse } from "./mcp.types";

export const CORE_TOOL_COUNT = 1;

export function registerCoreTools(
  server: McpServer,
  orgId: string,
  agentId: string,
): void {
  // ── core_add_messages ────────────────────────────────────────────────
  server.tool(
    "core_add_messages",
    "Add conversation messages to the current session",
    {
      session_id: z.string().describe("The current session ID"),
      messages: z
        .array(
          z.object({
            role: z
              .enum(["user", "assistant", "system", "tool"])
              .describe("Message role"),
            content: z.string().optional().describe("Message text content"),
            occurred_at: z
              .string()
              .datetime()
              .describe("ISO 8601 timestamp of when the message occurred"),
            tool_calls: z
              .array(
                z.object({
                  tool_call_id: z.string().describe("Tool call identifier"),
                  tool_name: z.string().describe("Name of the tool called"),
                  tool_input: z
                    .record(z.unknown())
                    .optional()
                    .describe("Input passed to the tool"),
                  tool_output: z
                    .record(z.unknown())
                    .optional()
                    .describe("Output returned by the tool"),
                }),
              )
              .optional()
              .describe("Tool calls associated with this message"),
          }),
        )
        .describe("Messages to add"),
    },
    async ({ session_id, messages }) => {
      try {
        enrichLogger({ sessionId: session_id });
        const log = getLogger();

        const rows = await addMessages(
          orgId,
          session_id,
          agentId,
          messages.map((msg) => ({
            role: msg.role,
            content: msg.content,
            occurredAt: new Date(msg.occurred_at),
            toolCalls: msg.tool_calls?.map((tc) => ({
              toolCallId: tc.tool_call_id,
              toolName: tc.tool_name,
              toolInput: tc.tool_input as Record<string, unknown> | undefined,
              toolOutput: tc.tool_output as Record<string, unknown> | undefined,
            })),
          })),
        );

        log.info({ messagesAdded: rows.length }, "messages added to session");

        return mcpResponse({
          session_id,
          messages_added: rows.length,
        });
      } catch (err) {
        getLogger().error({ err }, "failed to add messages");
        return mcpErrorResponse(err, "Failed to add messages");
      }
    },
  );
}
