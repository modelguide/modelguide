/**
 * Sessions service - business logic for session and message management
 */

import { db } from "@db/client";
import { forOrg } from "@db/rls";
import {
  agents,
  sessionFeedback,
  sessionLinks,
  sessionMessages,
  sessions,
} from "@db/schema";
import { Errors } from "@lib/errors";
import {
  type PaginationParams,
  buildPaginationMeta,
  getOffset,
} from "@lib/pagination";
import { and, asc, count, desc, eq, gt, gte, lte, sql } from "drizzle-orm";
import { extractLinks } from "./link-extraction";

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

const TERMINAL_STATUSES = ["completed", "abandoned"] as const;

function isTerminal(status: string): boolean {
  return TERMINAL_STATUSES.includes(
    status as (typeof TERMINAL_STATUSES)[number],
  );
}

// ============================================================================
// Session queries (RLS via forOrg)
// ============================================================================

export async function listSessions(orgId: string, filters: SessionFilters) {
  const { page, pageSize } = filters;
  const offset = getOffset(page, pageSize);

  return forOrg(orgId, async (tx) => {
    const conditions = buildFilterConditions(filters);
    const { sortDir, sortColumn } = buildSort(filters);

    // Subqueries for aggregated data
    const messageCountSq = db
      .select({
        sessionId: sessionMessages.sessionId,
        messageCount: count().as("message_count"),
      })
      .from(sessionMessages)
      .groupBy(sessionMessages.sessionId)
      .as("msg_counts");

    const feedbackSq = db
      .select({
        sessionId: sessionFeedback.sessionId,
        feedbackCount: count().as("feedback_count"),
        customerRating: sql<
          number | null
        >`(array_agg(${sessionFeedback.rating} order by coalesce(${sessionFeedback.updatedAt}, ${sessionFeedback.createdAt}) desc) filter (where ${sessionFeedback.feedbackSource} = 'customer'))[1]`.as(
          "customer_rating",
        ),
        supportRating: sql<
          number | null
        >`(array_agg(${sessionFeedback.rating} order by coalesce(${sessionFeedback.updatedAt}, ${sessionFeedback.createdAt}) desc) filter (where ${sessionFeedback.feedbackSource} = 'support'))[1]`.as(
          "support_rating",
        ),
      })
      .from(sessionFeedback)
      .groupBy(sessionFeedback.sessionId)
      .as("fb_counts");

    // Apply hasFeedback filter (depends on feedbackSq)
    if (filters.hasFeedback === true) {
      conditions.push(gt(sql`coalesce(${feedbackSq.feedbackCount}, 0)`, 0));
    } else if (filters.hasFeedback === false) {
      conditions.push(eq(sql`coalesce(${feedbackSq.feedbackCount}, 0)`, 0));
    }

    const finalWhere = conditions.length > 0 ? and(...conditions) : undefined;

    // Data query
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
        customerRating: feedbackSq.customerRating,
        supportRating: feedbackSq.supportRating,
      })
      .from(sessions)
      .leftJoin(agents, eq(sessions.agentId, agents.id))
      .leftJoin(messageCountSq, eq(sessions.id, messageCountSq.sessionId))
      .leftJoin(feedbackSq, eq(sessions.id, feedbackSq.sessionId));

    // Count query (joins feedbackSq only when hasFeedback filter is used)
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

    return {
      data: items.map((row) => ({
        ...row.session,
        agent: { id: row.session.agentId, name: row.agentName ?? "Unknown" },
        messageCount: Number(row.messageCount),
        durationSeconds: computeDuration(
          row.session.startedAt,
          row.session.endedAt,
        ),
        feedbackSummary: {
          hasFeedback: Number(row.feedbackCount) > 0,
          customerRating: row.customerRating ?? null,
          supportRating: row.supportRating ?? null,
        },
      })),
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

    const [messages, feedback, links] = await Promise.all([
      tx
        .select()
        .from(sessionMessages)
        .where(eq(sessionMessages.sessionId, sessionId))
        .orderBy(
          asc(sessionMessages.occurredAt),
          asc(sessionMessages.createdAt),
        ),
      tx
        .select()
        .from(sessionFeedback)
        .where(eq(sessionFeedback.sessionId, sessionId))
        .orderBy(asc(sessionFeedback.createdAt)),
      tx
        .select()
        .from(sessionLinks)
        .where(eq(sessionLinks.sessionId, sessionId))
        .orderBy(asc(sessionLinks.createdAt)),
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
      links,
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
  },
) {
  return forOrg(orgId, async (tx) => {
    const [existing] = await tx
      .select({ id: sessions.id, status: sessions.status })
      .from(sessions)
      .where(and(eq(sessions.id, sessionId), eq(sessions.agentId, agentId)));

    if (!existing) {
      throw Errors.sessionNotFound(sessionId);
    }

    if (isTerminal(existing.status)) {
      throw Errors.sessionAlreadyEnded(sessionId);
    }

    const updateData: Partial<typeof sessions.$inferInsert> = {};

    if (data.status) {
      if (!isTerminal(data.status)) {
        throw Errors.validationError(
          `Invalid status transition. Allowed: ${TERMINAL_STATUSES.join(", ")}`,
        );
      }
      updateData.status = data.status as typeof sessions.$inferInsert.status;
      updateData.endedAt = new Date();
    }

    const [updated] = await tx
      .update(sessions)
      .set(updateData)
      .where(eq(sessions.id, sessionId))
      .returning();

    return updated;
  });
}

export interface MessageData {
  role: string;
  content?: string;
  audioUrl?: string;
  occurredAt?: Date;
  toolCalls?: Array<{
    toolCallId: string;
    toolName: string;
    toolInput?: Record<string, unknown>;
    toolOutput?: Record<string, unknown>;
    latencyMs?: number;
  }>;
}

export async function addMessage(
  orgId: string,
  sessionId: string,
  agentId: string,
  data: MessageData,
) {
  return addMessages(orgId, sessionId, agentId, [data]);
}

export async function addMessages(
  orgId: string,
  sessionId: string,
  agentId: string,
  messages: MessageData[],
) {
  return forOrg(orgId, async (tx) => {
    const [session] = await tx
      .select({ id: sessions.id, status: sessions.status })
      .from(sessions)
      .where(and(eq(sessions.id, sessionId), eq(sessions.agentId, agentId)));

    if (!session) throw Errors.sessionNotFound(sessionId);
    if (isTerminal(session.status)) {
      throw Errors.sessionAlreadyEnded(sessionId);
    }

    // Flatten messages + their tool calls into a single values array
    const rows: (typeof sessionMessages.$inferInsert)[] = [];

    for (const msg of messages) {
      // Safe: each postStepMessages() call uses a distinct occurredAt.
      // If batching tool-only messages with identical timestamps,
      // keep the wrapper row or add an explicit sequence column.
      //
      // Skip the assistant wrapper row when it has no content — the tool rows
      // below carry all the information and the empty row just shows as a blank
      // message in the transcript.
      const isEmptyAssistant =
        msg.role === "assistant" &&
        !msg.content &&
        !msg.audioUrl &&
        !!msg.toolCalls?.length;

      if (!isEmptyAssistant) {
        rows.push({
          sessionId,
          role: msg.role as (typeof sessionMessages.role.enumValues)[number],
          content: msg.content ?? null,
          audioUrl: msg.audioUrl ?? null,
          occurredAt: msg.occurredAt ?? null,
        });
      }

      if (msg.role === "assistant" && msg.toolCalls?.length) {
        for (const tc of msg.toolCalls) {
          rows.push({
            sessionId,
            role: "tool",
            content: null,
            toolCallId: tc.toolCallId,
            toolName: tc.toolName,
            toolInput: tc.toolInput ?? null,
            toolOutput: tc.toolOutput ?? null,
            latencyMs: tc.latencyMs ?? null,
            occurredAt: msg.occurredAt ?? null,
          });
        }
      }
    }

    const inserted = await tx.insert(sessionMessages).values(rows).returning();

    // Extract external resource links from tool call outputs
    const toolCallsWithOutput = messages
      .flatMap((msg) => msg.toolCalls ?? [])
      .filter((tc) => tc.toolOutput)
      .map((tc) => ({
        toolName: tc.toolName,
        toolOutput: tc.toolOutput as Record<string, unknown>,
      }));

    const extracted = extractLinks(toolCallsWithOutput);
    if (extracted.length > 0) {
      await tx
        .insert(sessionLinks)
        .values(extracted.map((l) => ({ ...l, sessionId })))
        .onConflictDoNothing({
          target: [sessionLinks.sessionId, sessionLinks.url],
        });
    }

    return inserted;
  });
}

// ============================================================================
// Helpers
// ============================================================================

function buildFilterConditions(filters: SessionFilters) {
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

  return conditions;
}

function getSortColumn(sortBy: SessionFilters["sortBy"]) {
  switch (sortBy) {
    case "ended_at":
      return sessions.endedAt;
    case "status":
      return sessions.status;
    default:
      return sessions.startedAt;
  }
}

function buildSort(filters: SessionFilters) {
  const sortColumn = getSortColumn(filters.sortBy);
  const sortDir = filters.sortOrder === "asc" ? asc : desc;
  return { sortDir, sortColumn };
}

function computeDuration(startedAt: Date, endedAt: Date | null): number | null {
  if (!endedAt) return null;
  return Math.round((endedAt.getTime() - startedAt.getTime()) / 1000);
}

// ============================================================================
// Session validation (for MCP connector tools)
// ============================================================================

export async function validateActiveSession(
  orgId: string,
  sessionId: string,
  agentId: string,
) {
  return forOrg(orgId, async (tx) => {
    const [session] = await tx
      .select()
      .from(sessions)
      .where(and(eq(sessions.id, sessionId), eq(sessions.agentId, agentId)));

    if (!session) throw Errors.sessionNotFound(sessionId);
    if (isTerminal(session.status)) {
      throw Errors.sessionAlreadyEnded(sessionId);
    }
    return session;
  });
}
