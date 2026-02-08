/**
 * Analytics service - aggregation queries for sessions and feedback
 */

import { forOrg } from "@db/rls";
import { sessionFeedback, sessions } from "@db/schema";
import { and, eq, gte, lte, sql } from "drizzle-orm";

export interface AnalyticsFilters {
  agentId?: string;
  channelType?: string;
  fromDate: string;
  toDate: string;
}

export interface SummaryResult {
  period: { from: string; to: string };
  total_sessions: number;
  sessions_by_status: {
    active: number;
    completed: number;
    escalated: number;
    abandoned: number;
  };
  sessions_by_channel: {
    voice: number;
    web: number;
    api: number;
    slack: number;
    widget: number;
    sms: number;
    whatsapp: number;
    email: number;
  };
  resolution_rate: number;
  escalation_rate: number;
  abandonment_rate: number;
  avg_duration_seconds: number | null;
  csat_score: number | null;
  support_evaluation_score: number | null;
  feedback_count: { customer: number; support: number };
}

export interface TrendPoint {
  date: string;
  value: number;
}

export interface TrendsResult {
  metric: string;
  granularity: string;
  data: TrendPoint[];
}

function buildSessionFilters(filters: AnalyticsFilters) {
  const conditions = [
    gte(sessions.startedAt, new Date(filters.fromDate)),
    lte(sessions.startedAt, new Date(filters.toDate)),
  ];

  if (filters.agentId) {
    conditions.push(eq(sessions.agentId, filters.agentId));
  }
  if (filters.channelType) {
    conditions.push(
      sql`${sessions.channelType} = ${filters.channelType}` as ReturnType<
        typeof eq
      >,
    );
  }

  return and(...conditions)!;
}

export async function getSummary(
  orgId: string,
  filters: AnalyticsFilters,
): Promise<SummaryResult> {
  return forOrg(orgId, async (tx) => {
    const where = buildSessionFilters(filters);

    // Single aggregation query for session metrics
    const [row] = await tx
      .select({
        total: sql<number>`count(*)::int`,
        active: sql<number>`count(*) filter (where ${sessions.status} = 'active')::int`,
        completed: sql<number>`count(*) filter (where ${sessions.status} = 'completed')::int`,
        escalated: sql<number>`count(*) filter (where ${sessions.status} = 'escalated')::int`,
        abandoned: sql<number>`count(*) filter (where ${sessions.status} = 'abandoned')::int`,
        voice: sql<number>`count(*) filter (where ${sessions.channelType} = 'voice')::int`,
        web: sql<number>`count(*) filter (where ${sessions.channelType} = 'web')::int`,
        api: sql<number>`count(*) filter (where ${sessions.channelType} = 'api')::int`,
        slack: sql<number>`count(*) filter (where ${sessions.channelType} = 'slack')::int`,
        widget: sql<number>`count(*) filter (where ${sessions.channelType} = 'widget')::int`,
        sms: sql<number>`count(*) filter (where ${sessions.channelType} = 'sms')::int`,
        whatsapp: sql<number>`count(*) filter (where ${sessions.channelType} = 'whatsapp')::int`,
        email: sql<number>`count(*) filter (where ${sessions.channelType} = 'email')::int`,
        avgDuration: sql<number | null>`avg(extract(epoch from (${sessions.endedAt} - ${sessions.startedAt}))) filter (where ${sessions.endedAt} is not null)`,
      })
      .from(sessions)
      .where(where);

    const total = row.total;

    // Feedback aggregation via subquery joined to sessions
    const [feedbackRow] = await tx
      .select({
        csatScore: sql<number | null>`avg(${sessionFeedback.rating}) filter (where ${sessionFeedback.feedbackSource} = 'customer')`,
        supportScore: sql<number | null>`avg(${sessionFeedback.rating}) filter (where ${sessionFeedback.feedbackSource} = 'support')`,
        customerCount: sql<number>`count(*) filter (where ${sessionFeedback.feedbackSource} = 'customer')::int`,
        supportCount: sql<number>`count(*) filter (where ${sessionFeedback.feedbackSource} = 'support')::int`,
      })
      .from(sessionFeedback)
      .innerJoin(sessions, eq(sessionFeedback.sessionId, sessions.id))
      .where(where);

    return {
      period: { from: filters.fromDate, to: filters.toDate },
      total_sessions: total,
      sessions_by_status: {
        active: row.active,
        completed: row.completed,
        escalated: row.escalated,
        abandoned: row.abandoned,
      },
      sessions_by_channel: {
        voice: row.voice,
        web: row.web,
        api: row.api,
        slack: row.slack,
        widget: row.widget,
        sms: row.sms,
        whatsapp: row.whatsapp,
        email: row.email,
      },
      resolution_rate: total > 0 ? row.completed / total : 0,
      escalation_rate: total > 0 ? row.escalated / total : 0,
      abandonment_rate: total > 0 ? row.abandoned / total : 0,
      avg_duration_seconds: row.avgDuration
        ? Number(Number(row.avgDuration).toFixed(2))
        : null,
      csat_score: feedbackRow.csatScore
        ? Number(Number(feedbackRow.csatScore).toFixed(2))
        : null,
      support_evaluation_score: feedbackRow.supportScore
        ? Number(Number(feedbackRow.supportScore).toFixed(2))
        : null,
      feedback_count: {
        customer: feedbackRow.customerCount,
        support: feedbackRow.supportCount,
      },
    };
  });
}

export async function getTrends(
  orgId: string,
  metric: string,
  granularity: string,
  filters: AnalyticsFilters,
): Promise<TrendsResult> {
  return forOrg(orgId, async (tx) => {
    const where = buildSessionFilters(filters);
    const bucket = sql`date_trunc(${sql.raw(`'${granularity}'`)}, ${sessions.startedAt})`;

    let data: TrendPoint[];

    if (metric === "csat") {
      const rows = await tx
        .select({
          date: bucket.as("bucket"),
          value: sql<number>`coalesce(avg(${sessionFeedback.rating}), 0)`,
        })
        .from(sessions)
        .innerJoin(
          sessionFeedback,
          and(
            eq(sessionFeedback.sessionId, sessions.id),
            eq(sessionFeedback.feedbackSource, "customer"),
          ),
        )
        .where(where)
        .groupBy(sql`bucket`)
        .orderBy(sql`bucket`);

      data = rows.map((r) => ({
        date: new Date(r.date as unknown as string).toISOString(),
        value: Number(Number(r.value).toFixed(2)),
      }));
    } else if (metric === "duration") {
      const rows = await tx
        .select({
          date: bucket.as("bucket"),
          value: sql<number>`coalesce(avg(extract(epoch from (${sessions.endedAt} - ${sessions.startedAt}))) filter (where ${sessions.endedAt} is not null), 0)`,
        })
        .from(sessions)
        .where(where)
        .groupBy(sql`bucket`)
        .orderBy(sql`bucket`);

      data = rows.map((r) => ({
        date: new Date(r.date as unknown as string).toISOString(),
        value: Number(Number(r.value).toFixed(2)),
      }));
    } else {
      // sessions, resolution_rate, escalation_rate
      const valueExpr =
        metric === "sessions"
          ? sql<number>`count(*)::int`
          : metric === "resolution_rate"
            ? sql<number>`case when count(*) > 0 then count(*) filter (where ${sessions.status} = 'completed')::float / count(*)::float else 0 end`
            : sql<number>`case when count(*) > 0 then count(*) filter (where ${sessions.status} = 'escalated')::float / count(*)::float else 0 end`;

      const rows = await tx
        .select({
          date: bucket.as("bucket"),
          value: valueExpr,
        })
        .from(sessions)
        .where(where)
        .groupBy(sql`bucket`)
        .orderBy(sql`bucket`);

      data = rows.map((r) => ({
        date: new Date(r.date as unknown as string).toISOString(),
        value:
          metric === "sessions"
            ? Number(r.value)
            : Number(Number(r.value).toFixed(4)),
      }));
    }

    return { metric, granularity, data };
  });
}
