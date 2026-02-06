/**
 * Sessions service - business logic for session and message management
 */

import { db } from "@db/client";
import { forOrg } from "@db/rls";
import { agents, sessionFeedback, sessionMessages, sessions } from "@db/schema";
import { Errors } from "@lib/errors";
import {
  type PaginationParams,
  buildPaginationMeta,
  getOffset,
} from "@lib/pagination";
import { and, asc, count, desc, eq, gt, gte, lte, max, sql } from "drizzle-orm";

// ============================================================================
// Types
// ============================================================================

interface SessionFilters extends PaginationParams {
  agentId?: string;
  status?: string;
  channelType?: string;
  hasFeedback?: boolean;
  startedAfter?: string;
  startedBefore?: string;
  sortBy?: "started_at" | "ended_at" | "status";
  sortOrder?: "asc" | "desc";
}

const TERMINAL_STATUSES = ["completed", "escalated", "abandoned"] as const;

// ============================================================================
// Session queries (RLS via forOrg)
// ============================================================================

export async function listSessions(orgId: string, filters: SessionFilters) {
  const { page, pageSize } = filters;
  const offset = getOffset(page, pageSize);

  return forOrg(orgId, async (tx) => {
    // Build where conditions
    const conditions = [];

    if (filters.agentId) {
      conditions.push(eq(sessions.agentId, filters.agentId));
    }
    if (filters.status) {
      conditions.push(
        eq(
          sessions.status,
          filters.status as (typeof sessions.status.enumValues)[number],
        ),
      );
    }
    if (filters.channelType) {
      conditions.push(
        eq(
          sessions.channelType,
          filters.channelType as (typeof sessions.channelType.enumValues)[number],
        ),
      );
    }
    if (filters.startedAfter) {
      conditions.push(gte(sessions.startedAt, new Date(filters.startedAfter)));
    }
    if (filters.startedBefore) {
      conditions.push(lte(sessions.startedAt, new Date(filters.startedBefore)));
    }

    // Determine sort
    const sortColumn =
      filters.sortBy === "ended_at"
        ? sessions.endedAt
        : filters.sortBy === "status"
          ? sessions.status
          : sessions.startedAt;
    const sortDir = filters.sortOrder === "asc" ? asc : desc;

    // Message count subquery
    const messageCountSq = db
      .select({
        sessionId: sessionMessages.sessionId,
        messageCount: count().as("message_count"),
      })
      .from(sessionMessages)
      .groupBy(sessionMessages.sessionId)
      .as("msg_counts");

    // Feedback summary subquery
    const feedbackSq = db
      .select({
        sessionId: sessionFeedback.sessionId,
        feedbackCount: count().as("feedback_count"),
      })
      .from(sessionFeedback)
      .groupBy(sessionFeedback.sessionId)
      .as("fb_counts");

    // Build base query for data
    let dataQuery = tx
      .select({
        session: sessions,
        agentName: agents.name,
        messageCount:
          sql<number>`coalesce(${messageCountSq.messageCount}, 0)`.as(
            "msg_count",
          ),
        feedbackCount: sql<number>`coalesce(${feedbackSq.feedbackCount}, 0)`.as(
          "fb_count",
        ),
      })
      .from(sessions)
      .leftJoin(agents, eq(sessions.agentId, agents.id))
      .leftJoin(messageCountSq, eq(sessions.id, messageCountSq.sessionId))
      .leftJoin(feedbackSq, eq(sessions.id, feedbackSq.sessionId));

    // Apply hasFeedback filter
    if (filters.hasFeedback === true) {
      conditions.push(gt(sql`coalesce(${feedbackSq.feedbackCount}, 0)`, 0));
    } else if (filters.hasFeedback === false) {
      conditions.push(eq(sql`coalesce(${feedbackSq.feedbackCount}, 0)`, 0));
    }

    const finalWhere = conditions.length > 0 ? and(...conditions) : undefined;

    // Count query
    const countQuery = tx
      .select({ total: count() })
      .from(sessions)
      .leftJoin(feedbackSq, eq(sessions.id, feedbackSq.sessionId));

    if (finalWhere) {
      dataQuery = dataQuery.where(finalWhere) as typeof dataQuery;
      countQuery.where(finalWhere);
    }

    const [items, [{ total }]] = await Promise.all([
      dataQuery.orderBy(sortDir(sortColumn)).limit(pageSize).offset(offset),
      countQuery,
    ]);

    const data = items.map((row) => ({
      ...row.session,
      agent: { id: row.session.agentId, name: row.agentName ?? "Unknown" },
      messageCount: Number(row.messageCount),
      durationSeconds: computeDuration(
        row.session.startedAt,
        row.session.endedAt,
      ),
      feedbackSummary: {
        hasFeedback: Number(row.feedbackCount) > 0,
      },
    }));

    return {
      data,
      pagination: buildPaginationMeta(page, pageSize, total),
    };
  });
}

export async function getSessionById(orgId: string, sessionId: string) {
  return forOrg(orgId, async (tx) => {
    const [row] = await tx
      .select({
        session: sessions,
        agentName: agents.name,
      })
      .from(sessions)
      .leftJoin(agents, eq(sessions.agentId, agents.id))
      .where(eq(sessions.id, sessionId));

    if (!row) {
      throw Errors.sessionNotFound(sessionId);
    }

    const [messages, feedback] = await Promise.all([
      tx
        .select()
        .from(sessionMessages)
        .where(eq(sessionMessages.sessionId, sessionId))
        .orderBy(asc(sessionMessages.sequenceNumber)),
      tx
        .select()
        .from(sessionFeedback)
        .where(eq(sessionFeedback.sessionId, sessionId))
        .orderBy(asc(sessionFeedback.createdAt)),
    ]);

    return {
      ...row.session,
      agent: { id: row.session.agentId, name: row.agentName ?? "Unknown" },
      durationSeconds: computeDuration(
        row.session.startedAt,
        row.session.endedAt,
      ),
      messages,
      feedback,
    };
  });
}

export async function createSession(
  orgId: string,
  agentId: string,
  data: {
    externalId?: string;
    channelType: string;
    userIdentifier: string;
    userMetadata?: Record<string, unknown>;
  },
) {
  return forOrg(orgId, async (tx) => {
    // Validate agent exists and belongs to org
    const [agent] = await tx
      .select({ id: agents.id })
      .from(agents)
      .where(eq(agents.id, agentId));

    if (!agent) {
      throw Errors.agentNotFound(agentId);
    }

    const [session] = await tx
      .insert(sessions)
      .values({
        organizationId: orgId,
        agentId,
        externalId: data.externalId,
        channelType:
          data.channelType as (typeof sessions.channelType.enumValues)[number],
        userIdentifier: data.userIdentifier,
        userMetadata: data.userMetadata ?? {},
        status: "active",
        startedAt: new Date(),
      })
      .returning();

    return session;
  });
}

export async function updateSession(
  orgId: string,
  sessionId: string,
  agentId: string,
  data: {
    status?: string;
    escalationRef?: string;
  },
) {
  return forOrg(orgId, async (tx) => {
    const [existing] = await tx
      .select()
      .from(sessions)
      .where(and(eq(sessions.id, sessionId), eq(sessions.agentId, agentId)));

    if (!existing) {
      throw Errors.sessionNotFound(sessionId);
    }

    // Check if session is already in a terminal state
    if (
      TERMINAL_STATUSES.includes(
        existing.status as (typeof TERMINAL_STATUSES)[number],
      )
    ) {
      throw Errors.sessionAlreadyEnded(sessionId);
    }

    const updateData: Partial<typeof sessions.$inferInsert> = {};

    if (data.status) {
      // Only allow transitions from active to terminal states
      if (
        !TERMINAL_STATUSES.includes(
          data.status as (typeof TERMINAL_STATUSES)[number],
        )
      ) {
        throw Errors.validationError(
          `Invalid status transition. Allowed: ${TERMINAL_STATUSES.join(", ")}`,
        );
      }
      updateData.status = data.status as typeof sessions.$inferInsert.status;
      updateData.endedAt = new Date();
    }

    if (data.escalationRef !== undefined) {
      updateData.escalationRef = data.escalationRef;
    }

    const [updated] = await tx
      .update(sessions)
      .set(updateData)
      .where(eq(sessions.id, sessionId))
      .returning();

    return updated;
  });
}

export async function addMessage(
  orgId: string,
  sessionId: string,
  agentId: string,
  data: {
    role: string;
    content?: string;
    audioUrl?: string;
    toolCalls?: Array<{
      toolCallId: string;
      toolName: string;
      toolInput?: Record<string, unknown>;
      toolOutput?: Record<string, unknown>;
    }>;
  },
) {
  const maxAttempts = 3;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await forOrg(orgId, async (tx) => {
        // Validate session exists and belongs to agent
        const [session] = await tx
          .select()
          .from(sessions)
          .where(
            and(eq(sessions.id, sessionId), eq(sessions.agentId, agentId)),
          );

        if (!session) {
          throw Errors.sessionNotFound(sessionId);
        }

        if (
          TERMINAL_STATUSES.includes(
            session.status as (typeof TERMINAL_STATUSES)[number],
          )
        ) {
          throw Errors.sessionAlreadyEnded(sessionId);
        }

        // Get the current max sequence number
        const [maxSeq] = await tx
          .select({ max: max(sessionMessages.sequenceNumber) })
          .from(sessionMessages)
          .where(eq(sessionMessages.sessionId, sessionId));

        let nextSequence = (maxSeq?.max ?? 0) + 1;

        const createdMessages = [];

        // Insert the main message
        const [mainMessage] = await tx
          .insert(sessionMessages)
          .values({
            sessionId,
            role: data.role as (typeof sessionMessages.role.enumValues)[number],
            content: data.content ?? null,
            audioUrl: data.audioUrl ?? null,
            sequenceNumber: nextSequence,
          })
          .returning();

        createdMessages.push(mainMessage);
        nextSequence++;

        // If assistant message has tool calls, create tool messages
        if (data.role === "assistant" && data.toolCalls?.length) {
          for (const toolCall of data.toolCalls) {
            const [toolMessage] = await tx
              .insert(sessionMessages)
              .values({
                sessionId,
                role: "tool",
                content: null,
                toolCallId: toolCall.toolCallId,
                toolName: toolCall.toolName,
                toolInput: toolCall.toolInput ?? null,
                toolOutput: toolCall.toolOutput ?? null,
                sequenceNumber: nextSequence,
              })
              .returning();

            createdMessages.push(toolMessage);
            nextSequence++;
          }
        }

        return createdMessages;
      });
    } catch (error: unknown) {
      if (isSequenceConflict(error) && attempt < maxAttempts - 1) {
        continue;
      }
      throw error;
    }
  }

  throw new Error("Failed to add message after retries.");
}

// ============================================================================
// Helpers
// ============================================================================

function computeDuration(startedAt: Date, endedAt: Date | null): number | null {
  if (!endedAt) return null;
  return Math.round((endedAt.getTime() - startedAt.getTime()) / 1000);
}

function isSequenceConflict(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as Error & { code?: string }).code;
  if (code !== "23505") return false;
  return error.message.includes("session_messages_session_sequence_unique");
}
