import {
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Clock,
  MessageSquare,
  Minus,
  Percent,
  ThumbsUp,
} from 'lucide-react'
import { Card, CardContent } from '~/components/ui/card'
import { formatDuration, formatNumber, formatPercent } from '~/lib/utils'
import type { AnalyticsSummary as AnalyticsSummaryType } from '~/schemas/analytics'

interface AnalyticsSummaryProps {
  data: AnalyticsSummaryType
}

function computeDelta(current: number, previous: number | undefined | null): number | null {
  if (previous == null || previous === 0) return null
  return ((current - previous) / previous) * 100
}

function formatDelta(delta: number | null): string {
  if (delta === null) return ''
  const sign = delta > 0 ? '+' : ''
  return `${sign}${delta.toFixed(1)}%`
}

export function AnalyticsSummary({ data }: AnalyticsSummaryProps) {
  const prev = data.previous_period

  const metrics = [
    {
      key: 'total-sessions',
      label: 'Total Sessions',
      value: formatNumber(data.total_sessions),
      icon: MessageSquare,
      delta: computeDelta(data.total_sessions, prev?.total_sessions),
      invertDelta: false,
    },
    {
      key: 'resolution-rate',
      label: 'Resolution Rate',
      value: formatPercent(data.resolution_rate),
      icon: Percent,
      delta: computeDelta(data.resolution_rate, prev?.resolution_rate),
      invertDelta: false,
    },
    {
      key: 'avg-duration',
      label: 'Avg Duration',
      value:
        data.avg_duration_seconds != null ? formatDuration(data.avg_duration_seconds) : '\u2014',
      icon: Clock,
      delta: computeDelta(data.avg_duration_seconds ?? 0, prev?.avg_duration_seconds),
      invertDelta: true,
    },
    {
      key: 'csat-score',
      label: 'CSAT Score',
      value: data.csat_score != null ? `${(data.csat_score * 100).toFixed(1)}%` : '\u2014',
      icon: ThumbsUp,
      delta: computeDelta(data.csat_score ?? 0, prev?.csat_score),
      invertDelta: false,
    },
    {
      key: 'abandonment-rate',
      label: 'Abandonment Rate',
      value: formatPercent(data.abandonment_rate),
      icon: ArrowDownRight,
      delta: computeDelta(data.abandonment_rate, prev?.abandonment_rate),
      invertDelta: true,
    },
    {
      key: 'avg-messages',
      label: 'Avg Messages',
      value:
        data.avg_messages_per_session != null ? data.avg_messages_per_session.toFixed(1) : '\u2014',
      icon: MessageSquare,
      delta: computeDelta(data.avg_messages_per_session ?? 0, prev?.avg_messages_per_session),
      invertDelta: false,
    },
    {
      key: 'feedback-coverage',
      label: 'Feedback Coverage',
      value: formatPercent(data.feedback_coverage_rate),
      icon: BarChart3,
      delta: computeDelta(data.feedback_coverage_rate, prev?.feedback_coverage_rate),
      invertDelta: false,
    },
  ]

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {metrics.map((metric, index) => {
        const isPositive = metric.delta !== null && metric.delta > 0
        const isGood =
          metric.delta !== null ? (metric.invertDelta ? metric.delta < 0 : metric.delta > 0) : null

        return (
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
                {metric.delta === null ? (
                  <>
                    <Minus className="h-3 w-3 text-fg-muted" />
                    <span className="text-xs text-fg-muted">No comparison</span>
                  </>
                ) : (
                  <>
                    {isPositive ? (
                      <ArrowUpRight
                        className={`h-3 w-3 ${isGood ? 'text-success' : 'text-error'}`}
                      />
                    ) : (
                      <ArrowDownRight
                        className={`h-3 w-3 ${isGood ? 'text-success' : 'text-error'}`}
                      />
                    )}
                    <span
                      className={`text-xs font-medium ${isGood ? 'text-success' : 'text-error'}`}
                    >
                      {formatDelta(metric.delta)}
                    </span>
                    <span className="text-xs text-fg-muted">vs last period</span>
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
