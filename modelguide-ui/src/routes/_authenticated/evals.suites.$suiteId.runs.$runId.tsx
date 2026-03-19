import { useQuery } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import { ArrowLeft, Clock, MessageSquare, Play, Square } from 'lucide-react'
import { Badge } from '~/components/ui/badge'
import { Spinner } from '~/components/ui/spinner'
import { RunResultsCard } from '~/features/evals/components/run-results-card'
import { api } from '~/lib/api'
import { cn } from '~/lib/cn'
import { formatDate, formatDuration } from '~/lib/utils'
import type { EvalSuiteDetail, EvalSuiteRun } from '~/schemas/eval-suites'
import { PROMPT_SOURCE_LABELS } from '~/schemas/eval-suites'

export const Route = createFileRoute('/_authenticated/evals/suites/$suiteId/runs/$runId')({
  component: RunDetailPage,
})

function RunDetailPage() {
  const { suiteId, runId } = Route.useParams()

  const {
    data: run,
    isLoading: runLoading,
    error: runError,
  } = useQuery({
    queryKey: ['eval-suites', suiteId, 'runs', runId],
    queryFn: () => api.get(`eval-suites/${suiteId}/runs/${runId}`).json<EvalSuiteRun>(),
  })

  const { data: suite } = useQuery({
    queryKey: ['eval-suites', suiteId],
    queryFn: () => api.get(`eval-suites/${suiteId}`).json<EvalSuiteDetail>(),
  })

  const resultVariant =
    run?.passed === true ? 'success' : run?.passed === false ? 'error' : 'warning'
  const resultLabel =
    run?.passed === true ? 'Passed' : run?.passed === false ? 'Failed' : 'Inconclusive'

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4 animate-fade-up">
        <Link
          to="/evals/suites/$suiteId"
          params={{ suiteId }}
          className="flex h-8 w-8 items-center justify-center rounded text-fg-secondary hover:bg-bg-subtle hover:text-fg-primary"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-fg-primary">Run Results</h1>
          {suite ? <p className="mt-1 font-sans text-sm text-fg-secondary">{suite.name}</p> : null}
        </div>
        {run ? (
          <div className="flex items-center gap-2">
            <Badge variant={resultVariant}>{resultLabel}</Badge>
            <Badge variant="info">
              {PROMPT_SOURCE_LABELS[run.promptSource] ?? run.promptSource}
            </Badge>
          </div>
        ) : null}
      </div>

      {runLoading ? (
        <div className="flex justify-center py-12">
          <Spinner size="lg" />
        </div>
      ) : runError ? (
        <div className="rounded-lg border border-error/30 bg-error-muted p-6 text-center">
          <p className="text-sm text-error">Failed to load run results</p>
        </div>
      ) : run ? (
        <>
          {/* Metadata */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              {
                icon: Clock,
                label: 'Duration',
                value: run.durationMs != null ? formatDuration(run.durationMs / 1000) : '\u2014',
              },
              {
                icon: Play,
                label: 'Started',
                value: formatDate(run.startedAt, { format: 'full' }),
              },
              {
                icon: Square,
                label: 'Completed',
                value: run.completedAt ? formatDate(run.completedAt, { format: 'full' }) : '\u2014',
              },
            ].map((card, i) => (
              <div
                key={card.label}
                className={cn(
                  'group relative overflow-hidden rounded-xl border border-fg-subtle/10 bg-bg-elevated px-4 py-3',
                  'transition-all duration-200 hover:border-fg-subtle/20',
                )}
                style={{ animationDelay: `${i * 60}ms` }}
              >
                <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-brand-500/[0.03] via-transparent to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
                <div className="relative flex items-center gap-2">
                  <card.icon className="h-3.5 w-3.5 text-fg-muted" />
                  <p className="font-display text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
                    {card.label}
                  </p>
                </div>
                <p className="relative mt-1 font-mono text-sm tabular-nums text-fg-primary">
                  {card.value}
                </p>
              </div>
            ))}
            {run.sessionId ? (
              <Link
                to="/sessions/$id"
                params={{ id: run.sessionId }}
                className={cn(
                  'group relative overflow-hidden rounded-xl border border-fg-subtle/10 bg-bg-elevated px-4 py-3',
                  'transition-all duration-200 hover:border-brand-500/30',
                )}
                style={{ animationDelay: '180ms' }}
              >
                <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-brand-500/[0.03] via-transparent to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
                <div className="relative flex items-center gap-2">
                  <MessageSquare className="h-3.5 w-3.5 text-fg-muted" />
                  <p className="font-display text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
                    Session
                  </p>
                </div>
                <p className="relative mt-1 truncate font-mono text-xs tabular-nums text-brand-400">
                  {run.sessionId}
                </p>
              </Link>
            ) : null}
          </div>

          {/* Results */}
          <RunResultsCard testCaseResults={run.testCaseResults} testCases={suite?.testCases} />
        </>
      ) : null}
    </div>
  )
}
