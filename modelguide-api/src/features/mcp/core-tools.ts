/**
 * Core MCP tools — real session management backed by the sessions service.
 */

import { addFeedback } from "@features/feedback";
import { addMessages, createSession, updateSession } from "@features/sessions";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { mcpErrorResponse, mcpResponse } from "./mcp.types";

export const CORE_TOOL_COUNT = 4;

export function registerCoreTools(
  server: McpServer,
  orgId: string,
  agentId: string,
): void {
  // ── core_create_session ──────────────────────────────────────────────
  server.tool(
    "core_create_session",
    "Create a new conversation session",
    {
      channel_type: z
        .enum([
          "voice",
          "web",
          "api",
          "slack",
          "widget",
          "sms",
          "whatsapp",
          "email",
        ])
        .describe("Channel type for this session"),
      user_identifier: z
        .string()
        .describe("Identifier for the end-user (phone, email, etc.)"),
      external_id: z
        .string()
        .optional()
        .describe("External reference ID for correlation"),
      user_metadata: z
        .record(z.unknown())
        .optional()
        .describe("Arbitrary metadata about the user"),
    },
    async ({ channel_type, user_identifier, external_id, user_metadata }) => {
      try {
        const session = await createSession(orgId, agentId, {
          channelType: channel_type,
          userIdentifier: user_identifier,
          externalId: external_id,
          userMetadata: user_metadata as Record<string, unknown> | undefined,
        });

        return mcpResponse({
          session_id: session.id,
          status: session.status,
          channel_type: session.channelType,
        });
      } catch (err) {
        return mcpErrorResponse(err, "Failed to create session");
      }
    },
  );

  // ── core_end_session ─────────────────────────────────────────────────
  server.tool(
    "core_end_session",
    "End an active conversation session",
    {
      session_id: z.string().describe("Session ID to end"),
    },
    async ({ session_id }) => {
      try {
        const updated = await updateSession(orgId, session_id, agentId, {
          status: "completed",
        });

        return mcpResponse({
          session_id: updated.id,
          status: updated.status,
        });
      } catch (err) {
        return mcpErrorResponse(err, "Failed to end session");
      }
    },
  );

  // ── core_add_messages ────────────────────────────────────────────────
  server.tool(
    "core_add_messages",
    "Add conversation messages to a session",
    {
      session_id: z.string().describe("Session ID to add messages to"),
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

        return mcpResponse({
          session_id,
          messages_added: rows.length,
        });
      } catch (err) {
        return mcpErrorResponse(err, "Failed to add messages");
      }
    },
  );

  // ── core_rate_session ────────────────────────────────────────────────
  server.tool(
    "core_rate_session",
    "Record a customer satisfaction rating for a session",
    {
      session_id: z.string().describe("Session ID to rate"),
      rating: z
        .number()
        .int()
        .min(1)
        .max(2)
        .describe("Rating (1 = negative, 2 = positive)"),
    },
    async ({ session_id, rating }) => {
      try {
        await addFeedback(orgId, session_id, {
          rating,
          feedbackSource: "customer",
        });

        return mcpResponse({
          session_id,
          rating,
          recorded: true,
        });
      } catch (err) {
        return mcpErrorResponse(err, "Failed to record rating");
      }
    },
  );
}
