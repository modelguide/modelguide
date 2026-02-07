/**
 * Core MCP tools — real session management backed by the sessions service.
 */

import {
  addFeedback,
  addMessage,
  createSession,
  updateSession,
} from "@features/sessions";
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
      summary: z.string().optional().describe("Session summary"),
    },
    async ({ session_id, summary }) => {
      try {
        if (summary) {
          await addMessage(orgId, session_id, agentId, {
            role: "system",
            content: summary,
          });
        }

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

  // ── core_escalate_session ────────────────────────────────────────────
  server.tool(
    "core_escalate_session",
    "Escalate a session to a human agent",
    {
      session_id: z.string().describe("Session ID to escalate"),
      reason: z.string().optional().describe("Reason for escalation"),
      priority: z
        .string()
        .optional()
        .describe("Escalation priority (low, medium, high)"),
    },
    async ({ session_id, reason, priority }) => {
      try {
        if (reason) {
          await addMessage(orgId, session_id, agentId, {
            role: "system",
            content: reason,
          });
        }

        const updated = await updateSession(orgId, session_id, agentId, {
          status: "escalated",
          escalationRef: priority,
        });

        return mcpResponse({
          session_id: updated.id,
          status: updated.status,
        });
      } catch (err) {
        return mcpErrorResponse(err, "Failed to escalate session");
      }
    },
  );

  // ── core_rate_session ────────────────────────────────────────────────
  server.tool(
    "core_rate_session",
    "Record a customer satisfaction rating for a session",
    {
      session_id: z.string().describe("Session ID to rate"),
      rating: z.number().describe("Rating value (1 = negative, 2 = positive)"),
    },
    async ({ session_id, rating }) => {
      if (rating !== 1 && rating !== 2) {
        return mcpResponse(
          { error: "Invalid rating. Must be 1 (negative) or 2 (positive)." },
          true,
        );
      }

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
