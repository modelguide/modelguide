import { Activity, CheckCircle, MessageSquare, ThumbsUp } from 'lucide-react'
import { formatNumber, formatPercent } from '~/lib/utils'
import type { AnalyticsSummary } from '~/schemas/analytics'
import { StatCard } from './stat-card'

export interface StatsGridProps {
  data: AnalyticsSummary
}

function calcTrend(
  current: number,
  previous: number | null | undefined,
): { value: number; isPositive: boolean } | undefined {
  if (previous == null || previous === 0) return undefined
  const change = ((current - previous) / previous) * 100
  return { value: Math.abs(Math.round(change * 10) / 10), isPositive: change >= 0 }
}

export function StatsGrid({ data }: StatsGridProps) {
  const hasActiveSessions = data.sessions_by_status.active > 0
  const prev = data.previous_period

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      <StatCard
        label="Total Sessions"
        value={formatNumber(data.total_sessions)}
        trend={calcTrend(data.total_sessions, prev?.total_sessions)}
        icon={<MessageSquare className="h-5 w-5" />}
        accentColor="info"
        className="animate-fade-up stagger-1"
      />
      <StatCard
        label="Active Sessions"
        value={formatNumber(data.sessions_by_status.active)}
        icon={<Activity className="h-5 w-5" />}
        accentColor="purple"
        pulse={hasActiveSessions}
        className="animate-fade-up stagger-2"
      />
      <StatCard
        label="Resolution Rate"
        value={formatPercent(data.resolution_rate)}
        trend={calcTrend(data.resolution_rate, prev?.resolution_rate)}
        icon={<CheckCircle className="h-5 w-5" />}
        accentColor="success"
        className="animate-fade-up stagger-3"
      />
      <StatCard
        label="CSAT Score"
        value={data.csat_score != null ? data.csat_score.toFixed(1) : '\u2014'}
        trend={calcTrend(data.csat_score ?? 0, prev?.csat_score)}
        icon={<ThumbsUp className="h-5 w-5" />}
        accentColor="brand"
        className="animate-fade-up stagger-4"
      />
    </div>
  )
}
