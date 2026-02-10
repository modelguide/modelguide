import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { BarChart3 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { PageHeader } from '~/components/ui/page-header'
import { Select } from '~/components/ui/select'
import { Spinner } from '~/components/ui/spinner'
import { AgentPerformance } from '~/features/analytics/components/agent-performance'
import { AnalyticsSummary } from '~/features/analytics/components/analytics-summary'
import { ChannelBreakdown } from '~/features/analytics/components/channel-breakdown'
import { StatusBreakdown } from '~/features/analytics/components/status-breakdown'
import { TrendChart } from '~/features/analytics/components/trend-chart'
import { api } from '~/lib/api'
import {
  RANGE_LABELS,
  type RangePreset,
  computeDateRange,
  granularityForPreset,
} from '~/lib/date-ranges'
import { fillTrendGaps } from '~/lib/fill-trend-gaps'
import type {
  AgentPerformanceResponse,
  AnalyticsSummary as AnalyticsSummaryType,
  TrendsResponse,
} from '~/schemas/analytics'

export const Route = createFileRoute('/_authenticated/analytics')({
  component: AnalyticsPage,
})

function AnalyticsPage() {
  const [rangePreset, setRangePreset] = useState<RangePreset>('last30d')

  const { from, to } = computeDateRange(rangePreset)
  const granularity = granularityForPreset(rangePreset)

  const summaryQuery = useQuery({
    queryKey: ['analytics', 'summary', from, to],
    queryFn: () =>
      api
        .get('analytics', {
          searchParams: { from_date: from, to_date: to },
        })
        .json<AnalyticsSummaryType>(),
  })

  const sessionsTrendQuery = useQuery({
    queryKey: ['analytics', 'trends', 'sessions', granularity, from, to],
    queryFn: () =>
      api
        .get('analytics/trends', {
          searchParams: {
            metric: 'sessions',
            granularity,
            from_date: from,
            to_date: to,
          },
        })
        .json<TrendsResponse>(),
  })

  const resolutionTrendQuery = useQuery({
    queryKey: ['analytics', 'trends', 'resolution_rate', granularity, from, to],
    queryFn: () =>
      api
        .get('analytics/trends', {
          searchParams: {
            metric: 'resolution_rate',
            granularity,
            from_date: from,
            to_date: to,
          },
        })
        .json<TrendsResponse>(),
  })

  const agentQuery = useQuery({
    queryKey: ['analytics', 'agents', from, to],
    queryFn: () =>
      api
        .get('analytics/agents', {
          searchParams: { from_date: from, to_date: to },
        })
        .json<AgentPerformanceResponse>(),
  })

  const sessionsData = useMemo(
    () => fillTrendGaps(sessionsTrendQuery.data?.data ?? [], from, to, granularity),
    [sessionsTrendQuery.data, from, to, granularity],
  )

  const resolutionsData = useMemo(
    () => fillTrendGaps(resolutionTrendQuery.data?.data ?? [], from, to, granularity),
    [resolutionTrendQuery.data, from, to, granularity],
  )

  const trendsLoading = sessionsTrendQuery.isLoading || resolutionTrendQuery.isLoading

  return (
    <div className="space-y-6">
      <PageHeader
        icon={BarChart3}
        iconBg="bg-purple/15"
        iconColor="text-purple"
        title="Analytics"
        description="Performance metrics and trends"
        actions={
          <Select
            value={rangePreset}
            onChange={(e) => setRangePreset(e.target.value as RangePreset)}
            className="w-40"
          >
            {Object.entries(RANGE_LABELS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </Select>
        }
      />

      {summaryQuery.isLoading ? (
        <div className="flex justify-center py-12">
          <Spinner size="lg" />
        </div>
      ) : summaryQuery.error ? (
        <div className="rounded-lg border border-error/30 bg-error-muted p-6 text-center">
          <p className="text-sm text-error">Failed to load analytics</p>
        </div>
      ) : summaryQuery.data ? (
        <>
          <AnalyticsSummary data={summaryQuery.data} />

          <TrendChart
            sessions={sessionsData}
            resolutions={resolutionsData}
            isLoading={trendsLoading}
          />

          <div className="grid gap-6 lg:grid-cols-2">
            <StatusBreakdown data={summaryQuery.data.sessions_by_status} />
            <ChannelBreakdown data={summaryQuery.data.sessions_by_channel} />
          </div>

          <AgentPerformance
            agents={agentQuery.data?.agents ?? []}
            isLoading={agentQuery.isLoading}
          />
        </>
      ) : null}
    </div>
  )
}
