import type { AnalyticsSummary, AnalyticsTrendPoint } from '~/schemas/analytics'

const mockTrend: AnalyticsTrendPoint[] = [
  { date: '2024-01-08', sessions: 165, resolutions: 142, escalations: 11 },
  { date: '2024-01-09', sessions: 178, resolutions: 151, escalations: 14 },
  { date: '2024-01-10', sessions: 192, resolutions: 165, escalations: 12 },
  { date: '2024-01-11', sessions: 156, resolutions: 130, escalations: 15 },
  { date: '2024-01-12', sessions: 134, resolutions: 115, escalations: 9 },
  { date: '2024-01-13', sessions: 98, resolutions: 84, escalations: 7 },
  { date: '2024-01-14', sessions: 112, resolutions: 96, escalations: 8 },
  { date: '2024-01-15', sessions: 199, resolutions: 162, escalations: 13 },
]

export const mockAnalyticsSummary: AnalyticsSummary = {
  period: {
    from: '2024-01-08T00:00:00Z',
    to: '2024-01-15T23:59:59Z',
  },
  total_sessions: 1234,
  sessions_by_status: {
    completed: 1045,
    escalated: 89,
    abandoned: 45,
    active: 55,
  },
  sessions_by_channel: {
    voice: 623,
    web: 312,
    widget: 189,
    whatsapp: 78,
    sms: 32,
  },
  resolution_rate: 0.847,
  escalation_rate: 0.072,
  abandonment_rate: 0.036,
  avg_duration_seconds: 315,
  csat_score: 1.82,
  support_evaluation_score: 1.75,
  feedback_count: {
    customer: 456,
    support: 123,
  },
  trend: mockTrend,
}
