import { Activity, CheckCircle, MessageSquare, ThumbsUp } from 'lucide-react'
import { formatNumber, formatPercent } from '~/lib/utils'
import type { AnalyticsSummary } from '~/schemas/analytics'
import { StatCard } from './stat-card'

export interface StatsGridProps {
  data: AnalyticsSummary
}

export function StatsGrid({ data }: StatsGridProps) {
  const hasActiveSessions = data.sessions_by_status.active > 0

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      <StatCard
        label="Total Sessions"
        value={formatNumber(data.total_sessions)}
        trend={{ value: 12, isPositive: true }}
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
        trend={{ value: 3.2, isPositive: true }}
        icon={<CheckCircle className="h-5 w-5" />}
        accentColor="success"
        className="animate-fade-up stagger-3"
      />
      <StatCard
        label="CSAT Score"
        value={data.csat_score.toFixed(1)}
        trend={{ value: 0.1, isPositive: true }}
        icon={<ThumbsUp className="h-5 w-5" />}
        accentColor="brand"
        className="animate-fade-up stagger-4"
      />
    </div>
  )
}
