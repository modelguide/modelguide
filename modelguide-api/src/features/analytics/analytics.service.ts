/**
 * Analytics service - aggregation queries for sessions and feedback
 *
 * Note: sessionFeedback has no RLS. All feedback queries MUST join through
 * the RLS-protected sessions table to ensure tenant isolation — never query
 * sessionFeedback directly inside forOrg.
 */

import { forOrg } from "@db/rls";
import { sessionFeedback, sessions } from "@db/schema";
import { and, eq, gte, lt, sql } from "drizzle-orm";

type ChannelType = (typeof sessions.channelType.enumValues)[number];

const VALID_GRANULARITIES = ["hour", "day", "week", "month"] as const;
export type Granularity = (typeof VALID_GRANULARITIES)[number];

const VALID_METRICS = [
  "sessions",
  "csat",
  "resolution_rate",
  "escalation_rate",
  "duration",
] as const;
export type TrendMetric = (typeof VALID_METRICS)[number];

export interface AnalyticsFilters {
  agentId?: string;
  channelType?: ChannelType;
  fromDate: Date;
  toDate: Date;
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

function roundTo(value: number, decimals: number): number {
  return Number(value.toFixed(decimals));
}

function buildSessionFilters(filters: AnalyticsFilters) {
  const conditions = [
    gte(sessions.startedAt, filters.fromDate),
    lt(sessions.startedAt, filters.toDate),
  ];

  if (filters.agentId) {
    conditions.push(eq(sessions.agentId, filters.agentId));
  }
  if (filters.channelType) {
    conditions.push(eq(sessions.channelType, filters.channelType));
  }

  return and(...conditions)!;
}

export async function getSummary(
  orgId: string,
  filters: AnalyticsFilters,
): Promise<SummaryResult> {
  return forOrg(orgId, async (tx) => {
    const where = buildSessionFilters(filters);

    const [
      [row],
      // Feedback aggregation joined through RLS-protected sessions table
      [feedbackRow],
    ] = await Promise.all([
      // Session metrics aggregation
      tx
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
          avgDuration: sql<
            number | null
          >`avg(extract(epoch from (${sessions.endedAt} - ${sessions.startedAt}))) filter (where ${sessions.endedAt} is not null)`,
        })
        .from(sessions)
        .where(where),
      tx
        .select({
          csatScore: sql<
            number | null
          >`avg(${sessionFeedback.rating}) filter (where ${sessionFeedback.feedbackSource} = 'customer')`,
          supportScore: sql<
            number | null
          >`avg(${sessionFeedback.rating}) filter (where ${sessionFeedback.feedbackSource} = 'support')`,
          customerCount: sql<number>`count(*) filter (where ${sessionFeedback.feedbackSource} = 'customer')::int`,
          supportCount: sql<number>`count(*) filter (where ${sessionFeedback.feedbackSource} = 'support')::int`,
        })
        .from(sessionFeedback)
        .innerJoin(sessions, eq(sessionFeedback.sessionId, sessions.id))
        .where(where),
    ]);

    const total = row.total;
    const fromStr = filters.fromDate.toISOString().split("T")[0];
    const toStr = filters.toDate.toISOString().split("T")[0];

    return {
      period: { from: fromStr, to: toStr },
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
      resolution_rate: total > 0 ? roundTo(row.completed / total, 4) : 0,
      escalation_rate: total > 0 ? roundTo(row.escalated / total, 4) : 0,
      abandonment_rate: total > 0 ? roundTo(row.abandoned / total, 4) : 0,
      avg_duration_seconds: row.avgDuration
        ? roundTo(Number(row.avgDuration), 2)
        : null,
      csat_score: feedbackRow.csatScore
        ? roundTo(Number(feedbackRow.csatScore), 2)
        : null,
      support_evaluation_score: feedbackRow.supportScore
        ? roundTo(Number(feedbackRow.supportScore), 2)
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
  metric: TrendMetric,
  granularity: Granularity,
  filters: AnalyticsFilters,
): Promise<TrendsResult> {
  // Defense-in-depth: prevent raw SQL injection if called outside the route layer
  if (!(VALID_GRANULARITIES as readonly string[]).includes(granularity)) {
    throw new Error(`Invalid granularity: ${granularity}`);
  }

  return forOrg(orgId, async (tx) => {
    const where = buildSessionFilters(filters);
    const bucket = sql`date_trunc(${sql.raw(`'${granularity}'`)}, ${sessions.startedAt})`;

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

      return { metric, granularity, data: formatTrendRows(rows, 2) };
    }

    if (metric === "duration") {
      const rows = await tx
        .select({
          date: bucket.as("bucket"),
          value: sql<number>`coalesce(avg(extract(epoch from (${sessions.endedAt} - ${sessions.startedAt}))) filter (where ${sessions.endedAt} is not null), 0)`,
        })
        .from(sessions)
        .where(where)
        .groupBy(sql`bucket`)
        .orderBy(sql`bucket`);

      return { metric, granularity, data: formatTrendRows(rows, 2) };
    }

    let valueExpr: ReturnType<typeof sql<number>>;
    let precision: number;

    if (metric === "sessions") {
      valueExpr = sql<number>`count(*)::int`;
      precision = 0;
    } else if (metric === "resolution_rate") {
      valueExpr = sql<number>`case when count(*) > 0 then count(*) filter (where ${sessions.status} = 'completed')::float / count(*)::float else 0 end`;
      precision = 4;
    } else if (metric === "escalation_rate") {
      valueExpr = sql<number>`case when count(*) > 0 then count(*) filter (where ${sessions.status} = 'escalated')::float / count(*)::float else 0 end`;
      precision = 4;
    } else {
      throw new Error(`Unsupported trend metric: ${metric satisfies never}`);
    }

    const rows = await tx
      .select({
        date: bucket.as("bucket"),
        value: valueExpr,
      })
      .from(sessions)
      .where(where)
      .groupBy(sql`bucket`)
      .orderBy(sql`bucket`);

    return { metric, granularity, data: formatTrendRows(rows, precision) };
  });
}

function formatTrendRows(
  rows: { date: unknown; value: number }[],
  precision: number,
): TrendPoint[] {
  return rows.map((r) => ({
    date: new Date(r.date as string).toISOString(),
    value:
      precision > 0 ? roundTo(Number(r.value), precision) : Number(r.value),
  }));
}
