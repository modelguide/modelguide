import { z } from 'zod'

export const trendPointSchema = z.object({
  date: z.string(),
  value: z.number(),
})

export type TrendPoint = z.infer<typeof trendPointSchema>

export const trendsResponseSchema = z.object({
  metric: z.string(),
  granularity: z.string(),
  data: z.array(trendPointSchema),
})

export type TrendsResponse = z.infer<typeof trendsResponseSchema>

export type TrendMetric = 'sessions' | 'csat' | 'resolution_rate' | 'escalation_rate' | 'duration'
export type Granularity = 'hour' | 'day' | 'week' | 'month'

const previousPeriodSchema = z.object({
  total_sessions: z.number(),
  resolution_rate: z.number(),
  escalation_rate: z.number(),
  abandonment_rate: z.number(),
  avg_duration_seconds: z.number().nullable(),
  csat_score: z.number().nullable(),
  avg_messages_per_session: z.number().nullable(),
  feedback_coverage_rate: z.number(),
})

export type PreviousPeriod = z.infer<typeof previousPeriodSchema>

export const analyticsSummarySchema = z.object({
  period: z.object({
    from: z.string(),
    to: z.string(),
  }),
  total_sessions: z.number(),
  sessions_by_status: z.object({
    completed: z.number(),
    escalated: z.number(),
    abandoned: z.number(),
    active: z.number(),
  }),
  sessions_by_channel: z.record(z.string(), z.number()),
  resolution_rate: z.number(),
  escalation_rate: z.number(),
  abandonment_rate: z.number(),
  avg_duration_seconds: z.number().nullable(),
  csat_score: z.number().nullable(),
  support_evaluation_score: z.number().nullable(),
  feedback_count: z.object({
    customer: z.number(),
    support: z.number(),
  }),
  avg_messages_per_session: z.number().nullable(),
  feedback_coverage_rate: z.number(),
  previous_period: previousPeriodSchema.nullable(),
})

export type AnalyticsSummary = z.infer<typeof analyticsSummarySchema>

export const agentPerformanceItemSchema = z.object({
  agent_id: z.string(),
  agent_name: z.string(),
  total_sessions: z.number(),
  resolution_rate: z.number(),
  escalation_rate: z.number(),
  avg_duration_seconds: z.number().nullable(),
  csat_score: z.number().nullable(),
})

export type AgentPerformanceItem = z.infer<typeof agentPerformanceItemSchema>

export const agentPerformanceResponseSchema = z.object({
  agents: z.array(agentPerformanceItemSchema),
})

export type AgentPerformanceResponse = z.infer<typeof agentPerformanceResponseSchema>
