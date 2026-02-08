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
import { computeSummaryScores, formatTrendRows } from "./scoring.helpers";

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
  originalFromDate?: string;
  originalToDate?: string;
}

interface SessionsByStatus {
  active: number;
  completed: number;
  escalated: number;
  abandoned: number;
}

interface SessionsByChannel {
  voice: number;
  web: number;
  api: number;
  slack: number;
  widget: number;
  sms: number;
  whatsapp: number;
  email: number;
}

export interface SummaryResult {
  period: { from: string; to: string };
  total_sessions: number;
  sessions_by_status: SessionsByStatus;
  sessions_by_channel: SessionsByChannel;
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
  metric: TrendMetric;
  granularity: Granularity;
  data: TrendPoint[];
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

function querySessionMetrics(
  tx: Parameters<Parameters<typeof forOrg>[1]>[0],
  where: ReturnType<typeof buildSessionFilters>,
) {
  return tx
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
    .where(where);
}

function queryFeedbackMetrics(
  tx: Parameters<Parameters<typeof forOrg>[1]>[0],
  where: ReturnType<typeof buildSessionFilters>,
) {
  return tx
    .select({
      csatScore: sql<
        number | null
      >`count(*) filter (where ${sessionFeedback.feedbackSource} = 'customer' and ${sessionFeedback.rating} = 2)::float / nullif(count(*) filter (where ${sessionFeedback.feedbackSource} = 'customer'), 0)::float`,
      supportScore: sql<
        number | null
      >`count(*) filter (where ${sessionFeedback.feedbackSource} = 'support' and ${sessionFeedback.rating} = 2)::float / nullif(count(*) filter (where ${sessionFeedback.feedbackSource} = 'support'), 0)::float`,
      customerCount: sql<number>`count(*) filter (where ${sessionFeedback.feedbackSource} = 'customer')::int`,
      supportCount: sql<number>`count(*) filter (where ${sessionFeedback.feedbackSource} = 'support')::int`,
    })
    .from(sessionFeedback)
    .innerJoin(sessions, eq(sessionFeedback.sessionId, sessions.id))
    .where(where);
}

export async function getSummary(
  orgId: string,
  filters: AnalyticsFilters,
): Promise<SummaryResult> {
  return forOrg(orgId, async (tx) => {
    const where = buildSessionFilters(filters);

    const [[row], [feedbackRow]] = await Promise.all([
      querySessionMetrics(tx, where),
      queryFeedbackMetrics(tx, where),
    ]);

    const total = row.total;
    const fromStr =
      filters.originalFromDate ?? filters.fromDate.toISOString().split("T")[0];
    const toStr =
      filters.originalToDate ?? filters.toDate.toISOString().split("T")[0];

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
      ...computeSummaryScores(row, feedbackRow),
    };
  });
}

function rateExpr(status: string) {
  return sql<number>`case when count(*) > 0 then count(*) filter (where ${sessions.status} = ${status})::float / count(*)::float else 0 end`;
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
    const bucket = sql`date_trunc(${granularity}, ${sessions.startedAt})`;

    if (metric === "csat") {
      const rows = await tx
        .select({
          date: bucket.as("bucket"),
          value: sql<number>`coalesce(count(*) filter (where ${sessionFeedback.rating} = 2)::float / nullif(count(*), 0)::float, 0)`,
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

      return { metric, granularity, data: formatTrendRows(rows, 4) };
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
      valueExpr = rateExpr("completed");
      precision = 4;
    } else if (metric === "escalation_rate") {
      valueExpr = rateExpr("escalated");
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
