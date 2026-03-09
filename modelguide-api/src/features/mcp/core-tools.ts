/**
 * Core MCP tools — platform tools registered on every MCP server instance.
 */

import {
  addMessages,
  setCustomerOnSession,
  validateActiveSession,
} from "@features/sessions";
import { enrichLogger, getLogger } from "@lib/logger";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { mcpErrorResponse, mcpResponse } from "./mcp.types";

export const CORE_TOOL_COUNT = 2;

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
            model_used: z
              .string()
              .optional()
              .describe("LLM model used for this message"),
            tokens_used: z
              .number()
              .int()
              .optional()
              .describe("Total tokens consumed by this message"),
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
            modelUsed: msg.model_used,
            tokensUsed: msg.tokens_used,
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
        getLogger().warn(
          { err, tool: "core_add_messages" },
          "tool call rejected",
        );
        return mcpErrorResponse(err, "Failed to add messages");
      }
    },
  );

  // ── core_set_customer ──────────────────────────────────────────────
  server.tool(
    "core_set_customer",
    "Set or update customer identity on the current session",
    {
      session_id: z.string().describe("The current session ID"),
      name: z.string().optional().describe("Customer name"),
      email: z.string().email().optional().describe("Customer email"),
      phone: z.string().optional().describe("Customer phone number"),
    },
    async ({ session_id, name, email, phone }) => {
      try {
        enrichLogger({ sessionId: session_id });
        const log = getLogger();

        // Validate session is active and belongs to requesting agent
        await validateActiveSession(orgId, session_id, agentId);

        // Build raw input — setCustomerOnSession validates, normalizes,
        // and picks only known keys (name, email, phone)
        const raw: Record<string, unknown> = {};
        if (name) raw.name = name;
        if (email) raw.email = email;
        if (phone) raw.phone = phone;

        const { customer } = await setCustomerOnSession(orgId, session_id, raw);

        log.info(
          { sessionId: session_id, customer },
          "customer set on session",
        );

        return mcpResponse({
          session_id,
          customer,
        });
      } catch (err) {
        getLogger().warn(
          { err, tool: "core_set_customer" },
          "tool call rejected",
        );
        return mcpErrorResponse(err, "Failed to set customer");
      }
    },
  );
}
