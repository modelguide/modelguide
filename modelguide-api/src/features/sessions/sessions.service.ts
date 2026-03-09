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
import { getLogger } from "@lib/logger";
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
  customerSearch?: string;
  sortBy?: "started_at" | "ended_at" | "status";
  sortOrder?: "asc" | "desc";
}

export interface CustomerData {
  name?: string;
  email?: string;
  phone?: string;
}

/**
 * Normalize a phone string: strip all characters except digits and leading '+'.
 */
export function normalizePhone(raw: string): string {
  const hasLeadingPlus = raw.startsWith("+");
  const digits = raw.replace(/\D/g, "");
  return hasLeadingPlus ? `+${digits}` : digits;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Validate and normalize customer data. Picks only known keys (name, email, phone),
 * enforces length limits matching the API Zod schema, and normalizes phone.
 * Throws a validation error on bad input so both REST and MCP paths are protected.
 */
export function validateAndNormalizeCustomer(
  raw: CustomerData | Record<string, unknown>,
): CustomerData {
  const customer: CustomerData = {};

  if (raw.name !== undefined) {
    if (typeof raw.name !== "string" || raw.name.length > 255) {
      throw Errors.validationError(
        "Customer name must be a string of at most 255 characters",
      );
    }
    customer.name = raw.name;
  }

  if (raw.email !== undefined) {
    if (typeof raw.email !== "string" || !EMAIL_RE.test(raw.email)) {
      throw Errors.validationError(
        "Customer email must be a valid email address",
      );
    }
    customer.email = raw.email;
  }

  if (raw.phone !== undefined) {
    if (typeof raw.phone !== "string") {
      throw Errors.validationError("Customer phone must be a string");
    }
    const normalized = normalizePhone(raw.phone);
    if (normalized.length < 5) {
      throw Errors.validationError(
        "Phone must be at least 5 characters after normalization",
      );
    }
    if (normalized.length > 16) {
      throw Errors.validationError(
        "Phone must be at most 16 characters (15 digits + optional leading +)",
      );
    }
    customer.phone = normalized;
  }

  return customer;
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
      data: items.map((row) => {
        const meta = (row.session.metadata ?? {}) as Record<string, unknown>;
        const rawTokens = meta.llm_total_tokens;
        const rawCost = meta.cost_usd;
        return {
          ...row.session,
          agent: { id: row.session.agentId, name: row.agentName ?? "Unknown" },
          messageCount: Number(row.messageCount),
          durationSeconds: computeDuration(
            row.session.startedAt,
            row.session.endedAt,
          ),
          totalTokens: typeof rawTokens === "number" ? rawTokens : null,
          costUsd: typeof rawCost === "number" ? rawCost : null,
          feedbackSummary: {
            hasFeedback: Number(row.feedbackCount) > 0,
            customerRating: row.customerRating ?? null,
            supportRating: row.supportRating ?? null,
          },
        };
      }),
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
    customer?: CustomerData;
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
        customer: data.customer ?? null,
        status: "active",
        startedAt: new Date(),
      })
      .returning();

    getLogger().info(
      { sessionId: session.id, agentId, channelType: data.channelType },
      "session created",
    );

    return session;
  });
}

export async function updateSession(
  orgId: string,
  sessionId: string,
  agentId: string,
  data: {
    status?: string;
    metadata?: Record<string, unknown>;
    customer?: CustomerData;
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

    // Allow customer updates on active sessions, but block status changes on terminal sessions
    if (data.status && isTerminal(existing.status)) {
      throw Errors.sessionAlreadyEnded(sessionId);
    }

    // Block metadata updates on terminal sessions too
    if (data.metadata && isTerminal(existing.status)) {
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

    if (data.metadata) {
      updateData.metadata =
        sql`coalesce(${sessions.metadata}, '{}'::jsonb) || ${JSON.stringify(data.metadata)}::jsonb` as unknown as typeof updateData.metadata;
    }

    if (data.customer) {
      // Sanitize: pick only known keys and re-validate (guards MCP/internal callers)
      const safe = validateAndNormalizeCustomer(data.customer);
      updateData.customer =
        sql`coalesce(${sessions.customer}, '{}'::jsonb) || ${JSON.stringify(safe)}::jsonb` as unknown as typeof updateData.customer;
    }

    const [updated] = await tx
      .update(sessions)
      .set(updateData)
      .where(eq(sessions.id, sessionId))
      .returning();

    if (data.status) {
      getLogger().info(
        { sessionId, oldStatus: existing.status, newStatus: data.status },
        "session status changed",
      );
    }

    return updated;
  });
}

export interface MessageData {
  role: string;
  content?: string;
  audioUrl?: string;
  occurredAt?: Date;
  modelUsed?: string;
  tokensUsed?: number;
  toolCalls?: Array<{
    toolCallId: string;
    toolName: string;
    toolInput?: Record<string, unknown>;
    toolOutput?: Record<string, unknown>;
    latencyMs?: number;
    toolStatus?: "success" | "error";
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
          modelUsed: msg.modelUsed ?? null,
          tokensUsed: msg.tokensUsed ?? null,
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
            toolStatus: tc.toolStatus ?? null,
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

  if (filters.customerSearch) {
    const pattern = `%${filters.customerSearch}%`;
    conditions.push(
      sql`(${sessions.customer}->>'name' ILIKE ${pattern} OR ${sessions.customer}->>'email' ILIKE ${pattern} OR ${sessions.customer}->>'phone' ILIKE ${pattern})`,
    );
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

/**
 * Set customer data on a session that has already been validated as active.
 * Avoids a second session lookup (used by core_set_customer MCP tool).
 */
export async function setCustomerOnSession(
  orgId: string,
  sessionId: string,
  rawCustomer: Record<string, unknown>,
) {
  const safe = validateAndNormalizeCustomer(rawCustomer);

  return forOrg(orgId, async (tx) => {
    const [updated] = await tx
      .update(sessions)
      .set({
        customer:
          sql`coalesce(${sessions.customer}, '{}'::jsonb) || ${JSON.stringify(safe)}::jsonb` as unknown as typeof sessions.$inferInsert.customer,
      })
      .where(eq(sessions.id, sessionId))
      .returning();

    return { session: updated, customer: safe };
  });
}
