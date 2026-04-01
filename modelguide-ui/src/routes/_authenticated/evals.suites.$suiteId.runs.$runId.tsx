import { useQuery } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import { ArrowLeft, FlaskConical } from 'lucide-react'
import type { ReactNode } from 'react'
import { Badge } from '~/components/ui/badge'
import { Card, CardContent } from '~/components/ui/card'
import { Spinner } from '~/components/ui/spinner'
import { RunResultsCard } from '~/features/evals/components/run-results-card'
import { api } from '~/lib/api'
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
    refetchInterval: (query) => {
      const completedAt = query.state.data?.completedAt
      if (completedAt) return false
      return 2000
    },
  })

  const { data: suite } = useQuery({
    queryKey: ['eval-suites', suiteId],
    queryFn: () => api.get(`eval-suites/${suiteId}`).json<EvalSuiteDetail>(),
  })

  const isRunning = run != null && !run.completedAt
  const resultVariant = isRunning
    ? 'info'
    : run?.passed === true
      ? 'success'
      : run?.passed === false
        ? 'error'
        : 'warning'
  const resultLabel = isRunning
    ? 'Running...'
    : run?.passed === true
      ? 'Passed'
      : run?.passed === false
        ? 'Failed'
        : 'Inconclusive'

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
            <Badge variant={resultVariant} className={isRunning ? 'animate-pulse' : ''}>
              {resultLabel}
            </Badge>
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
          <Card>
            <CardContent className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              <InfoItem label="Duration">
                <p className="font-mono text-sm tabular-nums text-fg-primary">
                  {run.durationMs != null ? formatDuration(run.durationMs / 1000) : '\u2014'}
                </p>
              </InfoItem>
              <InfoItem label="Started">
                <p className="text-sm text-fg-primary">
                  {formatDate(run.startedAt, { format: 'full' })}
                </p>
              </InfoItem>
              <InfoItem label="Completed">
                <p className="text-sm text-fg-primary">
                  {run.completedAt ? formatDate(run.completedAt, { format: 'full' }) : '\u2014'}
                </p>
              </InfoItem>
              <InfoItem label="Type">
                <span className="inline-flex items-center gap-1.5 text-sm text-fg-secondary">
                  <FlaskConical className="h-3.5 w-3.5" />
                  Simulated
                </span>
              </InfoItem>
            </CardContent>
          </Card>

          {/* Results */}
          <RunResultsCard
            testCaseResults={run.testCaseResults}
            testCases={suite?.testCases}
            isRunning={isRunning}
          />
        </>
      ) : null}
    </div>
  )
}

function InfoItem({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium text-fg-muted">{label}</p>
      <div className="mt-1">{children}</div>
    </div>
  )
}
