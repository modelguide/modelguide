import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { BarChart3, Calendar } from 'lucide-react'
import { PageHeader } from '~/components/ui/page-header'
import { Spinner } from '~/components/ui/spinner'
import { AnalyticsSummary } from '~/features/analytics/components/analytics-summary'
import { ChannelBreakdown } from '~/features/analytics/components/channel-breakdown'
import { StatusBreakdown } from '~/features/analytics/components/status-breakdown'
import { TrendChart } from '~/features/analytics/components/trend-chart'
import { api } from '~/lib/api'
import { formatDate } from '~/lib/utils'
import type { AnalyticsSummary as AnalyticsSummaryType } from '~/schemas/analytics'

export const Route = createFileRoute('/_authenticated/analytics')({
  component: AnalyticsPage,
})

function AnalyticsPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['analytics', 'summary'],
    queryFn: () => api.get('analytics/summary').json<AnalyticsSummaryType>(),
  })

  return (
    <div className="space-y-6">
      <PageHeader
        icon={BarChart3}
        iconBg="bg-purple/15"
        iconColor="text-purple"
        title="Analytics"
        description="Performance metrics and trends"
        actions={
          data?.period ? (
            <div className="flex items-center gap-2 rounded-lg border border-fg-subtle/20 bg-bg-elevated px-3 py-2">
              <Calendar className="h-4 w-4 text-fg-muted" />
              <span className="text-xs text-fg-secondary">
                {formatDate(data.period.from)} — {formatDate(data.period.to)}
              </span>
            </div>
          ) : null
        }
      />

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Spinner size="lg" />
        </div>
      ) : error ? (
        <div className="rounded-lg border border-error/30 bg-error-muted p-6 text-center">
          <p className="text-sm text-error">Failed to load analytics</p>
        </div>
      ) : data ? (
        <>
          <AnalyticsSummary data={data} />

          {data.trend ? <TrendChart data={data.trend} /> : null}

          <div className="grid gap-6 lg:grid-cols-2">
            <StatusBreakdown data={data.sessions_by_status} />
            <ChannelBreakdown data={data.sessions_by_channel} />
          </div>
        </>
      ) : null}
    </div>
  )
}
