import {
  ArrowDownRight,
  ArrowUpRight,
  Clock,
  MessageSquare,
  Percent,
  Phone,
  ThumbsUp,
} from 'lucide-react'
import { Card, CardContent } from '~/components/ui/card'
import { formatDuration, formatNumber, formatPercent } from '~/lib/utils'
import type { AnalyticsSummary as AnalyticsSummaryType } from '~/schemas/analytics'

interface AnalyticsSummaryProps {
  data: AnalyticsSummaryType
}

export function AnalyticsSummary({ data }: AnalyticsSummaryProps) {
  const metrics = [
    {
      key: 'total-sessions',
      label: 'Total Sessions',
      value: formatNumber(data.total_sessions),
      icon: MessageSquare,
      trend: '+12%',
      trendUp: true,
    },
    {
      key: 'resolution-rate',
      label: 'Resolution Rate',
      value: formatPercent(data.resolution_rate),
      icon: Percent,
      trend: '+2.3%',
      trendUp: true,
    },
    {
      key: 'escalation-rate',
      label: 'Escalation Rate',
      value: formatPercent(data.escalation_rate),
      icon: Phone,
      trend: '-1.1%',
      trendUp: false,
    },
    {
      key: 'avg-duration',
      label: 'Avg Duration',
      value: formatDuration(data.avg_duration_seconds),
      icon: Clock,
      trend: '-15s',
      trendUp: false,
    },
    {
      key: 'csat-score',
      label: 'CSAT Score',
      value: data.csat_score.toFixed(2),
      icon: ThumbsUp,
      trend: '+0.08',
      trendUp: true,
    },
    {
      key: 'abandonment-rate',
      label: 'Abandonment Rate',
      value: formatPercent(data.abandonment_rate),
      icon: ArrowDownRight,
      trend: '-0.5%',
      trendUp: false,
    },
    {
      key: 'customer-feedback',
      label: 'Customer Feedback',
      value: formatNumber(data.feedback_count.customer),
      icon: MessageSquare,
      trend: '+23',
      trendUp: true,
    },
  ]

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
      {metrics.map((metric, index) => (
        <Card
          key={metric.key}
          className="animate-fade-up"
          style={{ animationDelay: `${index * 50}ms` }}
        >
          <CardContent className="p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-medium text-fg-muted">{metric.label}</p>
                <p className="mt-1 text-xl font-semibold text-fg-primary">{metric.value}</p>
              </div>
              <div className="rounded-lg bg-brand/10 p-2">
                <metric.icon className="h-4 w-4 text-brand" />
              </div>
            </div>
            <div className="mt-2 flex items-center gap-1">
              {metric.trendUp ? (
                <ArrowUpRight className="h-3 w-3 text-success" />
              ) : (
                <ArrowDownRight className="h-3 w-3 text-success" />
              )}
              <span className="text-xs font-medium text-success">{metric.trend}</span>
              <span className="text-xs text-fg-muted">vs last period</span>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
