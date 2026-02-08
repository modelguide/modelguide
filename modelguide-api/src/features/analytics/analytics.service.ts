/**
 * Analytics service - aggregation queries for sessions and feedback
 *
 * Note: sessionFeedback has no RLS. All feedback queries MUST join through
 * the RLS-protected sessions table to ensure tenant isolation — never query
 * sessionFeedback directly inside forOrg.
 */

import { forOrg } from "@db/rls";
import { agents, sessionFeedback, sessionMessages, sessions } from "@db/schema";
import { and, eq, gte, lt, sql } from "drizzle-orm";
import {
  computeSummaryScores,
  formatTrendRows,
  roundTo,
} from "./scoring.helpers";

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

export interface PreviousPeriodResult {
  total_sessions: number;
  resolution_rate: number;
  escalation_rate: number;
  abandonment_rate: number;
  avg_duration_seconds: number | null;
  csat_score: number | null;
  avg_messages_per_session: number | null;
  feedback_coverage_rate: number;
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
  avg_messages_per_session: number | null;
  feedback_coverage_rate: number;
  previous_period: PreviousPeriodResult | null;
}

export interface AgentPerformanceItem {
  agent_id: string;
  agent_name: string;
  total_sessions: number;
  resolution_rate: number;
  escalation_rate: number;
  avg_duration_seconds: number | null;
  csat_score: number | null;
}

export interface AgentPerformanceResult {
  agents: AgentPerformanceItem[];
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

function queryMessageMetrics(
  tx: Parameters<Parameters<typeof forOrg>[1]>[0],
  where: ReturnType<typeof buildSessionFilters>,
) {
  // Count user+assistant messages per session, then average across sessions
  return tx
    .select({
      avgMessages: sql<number | null>`
        avg(sub.msg_count)::float`,
    })
    .from(
      sql`(
        select ${sessions.id} as session_id,
          count(${sessionMessages.id})::int as msg_count
        from ${sessions}
        left join ${sessionMessages}
          on ${sessionMessages.sessionId} = ${sessions.id}
          and ${sessionMessages.role} in ('user', 'assistant')
        where ${where}
        group by ${sessions.id}
        having count(${sessionMessages.id}) > 0
      ) sub`,
    );
}

function queryFeedbackCoverage(
  tx: Parameters<Parameters<typeof forOrg>[1]>[0],
  where: ReturnType<typeof buildSessionFilters>,
) {
  return tx
    .select({
      feedbackCoverageRate: sql<number>`
        case when count(distinct ${sessions.id}) = 0 then 0
        else count(distinct ${sessionFeedback.sessionId})::float / count(distinct ${sessions.id})::float
        end`,
    })
    .from(sessions)
    .leftJoin(
      sessionFeedback,
      and(
        eq(sessionFeedback.sessionId, sessions.id),
        eq(sessionFeedback.feedbackSource, "customer"),
      ),
    )
    .where(where);
}

async function queryPeriodMetrics(
  tx: Parameters<Parameters<typeof forOrg>[1]>[0],
  filters: AnalyticsFilters,
) {
  const where = buildSessionFilters(filters);
  const [[row], [feedbackRow], [msgRow], [coverageRow]] = await Promise.all([
    querySessionMetrics(tx, where),
    queryFeedbackMetrics(tx, where),
    queryMessageMetrics(tx, where),
    queryFeedbackCoverage(tx, where),
  ]);

  const scores = computeSummaryScores(row, feedbackRow);

  return {
    total: row.total,
    sessionRow: row,
    scores,
    avgMessages: msgRow.avgMessages
      ? roundTo(Number(msgRow.avgMessages), 1)
      : null,
    feedbackCoverageRate: roundTo(Number(coverageRow.feedbackCoverageRate), 4),
  };
}

export async function getSummary(
  orgId: string,
  filters: AnalyticsFilters,
): Promise<SummaryResult> {
  return forOrg(orgId, async (tx) => {
    const current = await queryPeriodMetrics(tx, filters);

    const fromStr =
      filters.originalFromDate ?? filters.fromDate.toISOString().split("T")[0];
    const toStr =
      filters.originalToDate ?? filters.toDate.toISOString().split("T")[0];

    // Compute previous period
    const periodMs = filters.toDate.getTime() - filters.fromDate.getTime();
    const prevFrom = new Date(filters.fromDate.getTime() - periodMs);
    const prevTo = new Date(filters.fromDate);

    let previousPeriod: PreviousPeriodResult | null = null;

    // Only compute previous period if the date range is reasonable (after 2000)
    if (prevFrom.getFullYear() >= 2000) {
      const prev = await queryPeriodMetrics(tx, {
        ...filters,
        fromDate: prevFrom,
        toDate: prevTo,
      });

      previousPeriod = {
        total_sessions: prev.total,
        resolution_rate: prev.scores.resolution_rate,
        escalation_rate: prev.scores.escalation_rate,
        abandonment_rate: prev.scores.abandonment_rate,
        avg_duration_seconds: prev.scores.avg_duration_seconds,
        csat_score: prev.scores.csat_score,
        avg_messages_per_session: prev.avgMessages,
        feedback_coverage_rate: prev.feedbackCoverageRate,
      };
    }

    const row = current.sessionRow;
    return {
      period: { from: fromStr, to: toStr },
      total_sessions: current.total,
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
      ...current.scores,
      avg_messages_per_session: current.avgMessages,
      feedback_coverage_rate: current.feedbackCoverageRate,
      previous_period: previousPeriod,
    };
  });
}

export async function getAgentPerformance(
  orgId: string,
  filters: AnalyticsFilters,
): Promise<AgentPerformanceResult> {
  return forOrg(orgId, async (tx) => {
    const where = buildSessionFilters(filters);

    const rows = await tx
      .select({
        agentId: sessions.agentId,
        agentName: agents.name,
        total: sql<number>`count(*)::int`,
        completed: sql<number>`count(*) filter (where ${sessions.status} = 'completed')::int`,
        escalated: sql<number>`count(*) filter (where ${sessions.status} = 'escalated')::int`,
        avgDuration: sql<
          number | null
        >`avg(extract(epoch from (${sessions.endedAt} - ${sessions.startedAt}))) filter (where ${sessions.endedAt} is not null)`,
      })
      .from(sessions)
      .innerJoin(agents, eq(sessions.agentId, agents.id))
      .where(where)
      .groupBy(sessions.agentId, agents.name)
      .orderBy(sql`count(*) desc`);

    // Get CSAT per agent via separate query
    const csatRows = await tx
      .select({
        agentId: sessions.agentId,
        csatScore: sql<
          number | null
        >`count(*) filter (where ${sessionFeedback.rating} = 2)::float / nullif(count(*), 0)::float`,
      })
      .from(sessionFeedback)
      .innerJoin(sessions, eq(sessionFeedback.sessionId, sessions.id))
      .where(and(where, eq(sessionFeedback.feedbackSource, "customer")))
      .groupBy(sessions.agentId);

    const csatMap = new Map(csatRows.map((r) => [r.agentId, r.csatScore]));

    return {
      agents: rows.map((r) => ({
        agent_id: r.agentId,
        agent_name: r.agentName,
        total_sessions: r.total,
        resolution_rate: r.total > 0 ? roundTo(r.completed / r.total, 4) : 0,
        escalation_rate: r.total > 0 ? roundTo(r.escalated / r.total, 4) : 0,
        avg_duration_seconds: r.avgDuration
          ? roundTo(Number(r.avgDuration), 2)
          : null,
        csat_score: (() => {
          const score = csatMap.get(r.agentId);
          return score != null ? roundTo(Number(score), 4) : null;
        })(),
      })),
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
