import { useNavigate } from '@tanstack/react-router'
import { FlaskConical } from 'lucide-react'
import { Badge } from '~/components/ui/badge'
import { passRateVariant } from '~/lib/pass-rate'
import { formatDate, formatDuration } from '~/lib/utils'
import type { EvalSuiteRun } from '~/schemas/eval-suites'
import { PROMPT_SOURCE_LABELS } from '~/schemas/eval-suites'

export interface SuiteRunsTableProps {
  runs: EvalSuiteRun[]
  suiteId: string
  totalTestCases?: number
  isLoading?: boolean
}

function getPassCount(run: EvalSuiteRun): { passed: number; total: number } {
  const total = run.testCaseResults.length
  const passed = run.testCaseResults.filter((r) => r.passed === true).length
  return { passed, total }
}

export function SuiteRunsTable({ runs, suiteId, totalTestCases, isLoading }: SuiteRunsTableProps) {
  const navigate = useNavigate()

  if (isLoading) {
    return (
      <div className="overflow-hidden rounded-2xl border border-fg-subtle/10 bg-bg-elevated">
        <div className="space-y-0">
          {['skel-1', 'skel-2', 'skel-3'].map((key, i) => (
            <div
              key={key}
              className="h-16 border-b border-fg-subtle/5 last:border-0"
              style={{ animationDelay: `${i * 50}ms` }}
            >
              <div className="flex h-full items-center gap-4 px-5">
                <div className="h-6 w-16 animate-pulse rounded-full bg-bg-subtle" />
                <div className="h-3 w-20 animate-pulse rounded bg-bg-subtle" />
                <div className="h-3 w-24 animate-pulse rounded bg-bg-subtle" />
                <div className="flex-1" />
                <div className="h-3 w-16 animate-pulse rounded bg-bg-subtle" />
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (runs.length === 0) {
    return (
      <div className="relative flex flex-col items-center justify-center overflow-hidden rounded-2xl border border-fg-subtle/10 bg-bg-elevated py-20">
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-brand-500/[0.03] via-transparent to-transparent" />
        <div className="relative mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-bg-subtle">
          <FlaskConical className="h-8 w-8 text-fg-muted" />
        </div>
        <p className="relative font-display text-lg font-semibold text-fg-primary">No runs yet</p>
        <p className="relative mt-1 text-sm text-fg-muted">
          Run this suite against a session to see results
        </p>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-fg-subtle/15 bg-bg-elevated">
      <table className="w-full">
        <thead className="bg-bg-elevated">
          <tr className="border-b border-fg-subtle/10">
            <th className="px-4 py-3 text-left font-display text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
              Result
            </th>
            <th className="px-4 py-3 text-left font-display text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
              Prompt Source
            </th>
            <th className="px-4 py-3 text-left font-display text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
              Test Cases
            </th>
            <th className="px-4 py-3 text-left font-display text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
              Duration
            </th>
            <th className="px-4 py-3 text-left font-display text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
              Started
            </th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run, index) => {
            const { passed, total } = getPassCount(run)
            const passPct = total > 0 ? Math.round((passed / total) * 100) : 0
            const isInconclusive = run.passed == null
            const resultVariant = isInconclusive ? 'warning' : passRateVariant(passPct)
            const resultLabel = isInconclusive ? 'Inconclusive' : `Completed · ${passPct}%`

            return (
              <tr
                key={run.id}
                className="group cursor-pointer border-b border-fg-subtle/5 transition-colors hover:bg-bg-subtle/50 animate-fade-up"
                style={{ animationDelay: `${index * 30}ms` }}
                onClick={() =>
                  navigate({
                    to: '/evals/suites/$suiteId/runs/$runId',
                    params: { suiteId, runId: run.id },
                  })
                }
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    navigate({
                      to: '/evals/suites/$suiteId/runs/$runId',
                      params: { suiteId, runId: run.id },
                    })
                  }
                }}
                tabIndex={0}
              >
                <td className="px-4 py-3">
                  <Badge variant={resultVariant}>{resultLabel}</Badge>
                </td>
                <td className="px-4 py-3">
                  <Badge variant="info">
                    {PROMPT_SOURCE_LABELS[run.promptSource] ?? run.promptSource}
                  </Badge>
                </td>
                <td className="px-4 py-3">
                  <span className="text-sm tabular-nums text-fg-secondary">
                    {passed}/{total} passed
                  </span>
                  {totalTestCases != null && total < totalTestCases ? (
                    <Badge variant="default" className="ml-1.5">
                      partial
                    </Badge>
                  ) : null}
                </td>
                <td className="px-4 py-3">
                  <span className="font-mono text-sm tabular-nums text-fg-secondary">
                    {run.durationMs != null ? formatDuration(run.durationMs / 1000) : '\u2014'}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className="text-xs text-fg-muted">
                    {formatDate(run.startedAt, { format: 'relative' })}
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
