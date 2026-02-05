import { z } from 'zod'

export const analyticsTrendPointSchema = z.object({
  date: z.string(),
  sessions: z.number(),
  resolutions: z.number(),
  escalations: z.number(),
})

export type AnalyticsTrendPoint = z.infer<typeof analyticsTrendPointSchema>

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
  avg_duration_seconds: z.number(),
  csat_score: z.number(),
  support_evaluation_score: z.number(),
  feedback_count: z.object({
    customer: z.number(),
    support: z.number(),
  }),
  trend: z.array(analyticsTrendPointSchema).optional(),
})

export type AnalyticsSummary = z.infer<typeof analyticsSummarySchema>
