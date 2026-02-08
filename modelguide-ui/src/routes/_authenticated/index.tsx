import { useQuery } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import { ArrowRight, BarChart3, Sparkles } from 'lucide-react'
import { Button } from '~/components/ui/button'
import { PageHeader } from '~/components/ui/page-header'
import { StatsGrid } from '~/features/dashboard/components/stats-grid'
import { SessionsTable } from '~/features/sessions/components/sessions-table'
import { api } from '~/lib/api'
import { computeDateRange } from '~/lib/date-ranges'
import type { PaginatedResponse } from '~/lib/pagination'
import type { AnalyticsSummary } from '~/schemas/analytics'
import type { SessionListItem } from '~/schemas/sessions'

export const Route = createFileRoute('/_authenticated/')({
  component: DashboardPage,
})

function DashboardPage() {
  const { from: from_date, to: to_date } = computeDateRange('last30d')

  const { data: analytics, isLoading: analyticsLoading } = useQuery({
    queryKey: ['analytics', 'summary', from_date, to_date],
    queryFn: () =>
      api.get('analytics', { searchParams: { from_date, to_date } }).json<AnalyticsSummary>(),
  })

  const { data: sessionsData, isLoading: sessionsLoading } = useQuery({
    queryKey: ['sessions', 'recent'],
    queryFn: () =>
      api
        .get('sessions', {
          searchParams: { page: 1, pageSize: 5 },
        })
        .json<PaginatedResponse<SessionListItem>>(),
  })

  return (
    <div className="space-y-8">
      <PageHeader
        icon={Sparkles}
        iconBg="bg-brand-500/15"
        iconColor="text-brand-400"
        title="Dashboard"
        description="Overview of your agent operations"
      />

      {/* Stats Grid */}
      <div className="flex items-center justify-between">
        <h2 className="font-display text-xl font-semibold tracking-tight text-fg-primary">
          Last 30 Days
        </h2>
        <Link to="/analytics">
          <Button variant="ghost" size="sm" className="group">
            <BarChart3 className="mr-1 h-4 w-4" />
            View insights
            <ArrowRight className="ml-1 h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </Button>
        </Link>
      </div>
      {analyticsLoading || !analytics ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {['stat-1', 'stat-2', 'stat-3', 'stat-4'].map((key, i) => (
            <div
              key={key}
              className="h-36 rounded-2xl border border-fg-subtle/10 bg-bg-elevated p-5 animate-fade-up"
              style={{ animationDelay: `${i * 50}ms` }}
            >
              <div className="h-3 w-20 animate-pulse rounded bg-bg-subtle" />
              <div className="mt-4 h-10 w-24 animate-pulse rounded bg-bg-subtle" />
              <div className="mt-3 h-5 w-16 animate-pulse rounded-full bg-bg-subtle" />
            </div>
          ))}
        </div>
      ) : (
        <StatsGrid data={analytics} />
      )}

      {/* Recent Sessions */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-xl font-semibold tracking-tight text-fg-primary">
            Recent Sessions
          </h2>
          <Link to="/sessions">
            <Button variant="ghost" size="sm" className="group">
              View all
              <ArrowRight className="ml-1 h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Button>
          </Link>
        </div>
        <SessionsTable sessions={sessionsData?.data ?? []} isLoading={sessionsLoading} />
      </div>
    </div>
  )
}
