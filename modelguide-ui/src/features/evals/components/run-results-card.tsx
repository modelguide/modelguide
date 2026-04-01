import { Link } from '@tanstack/react-router'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Loader2,
  MinusCircle,
  Radio,
  XCircle,
} from 'lucide-react'
import { useState } from 'react'
import { Badge } from '~/components/ui/badge'
import { cn } from '~/lib/cn'
import type { EvalRunScore, EvalSuiteTestCase, TestCaseResult } from '~/schemas/eval-suites'

export interface RunResultsCardProps {
  testCaseResults: TestCaseResult[]
  testCases?: EvalSuiteTestCase[]
  isRunning?: boolean
  /** Number of pending test cases still being simulated. */
  pendingCount?: number
}

function getTestCaseName(result: TestCaseResult, testCases?: EvalSuiteTestCase[]): string {
  // Prefer the name returned directly in the run result
  if (result.testCaseName) return result.testCaseName
  // Fallback: look up from suite test cases
  if (result.testCaseId && testCases) {
    const tc = testCases.find((t) => t.id === result.testCaseId)
    if (tc) return tc.name
  }
  // Test case was removed (e.g. after re-init or regeneration)
  return result.testCaseId
    ? `Removed test case (${result.testCaseId.slice(0, 8)}…)`
    : 'Unknown Test Case'
}

function scoreIcon(score: EvalRunScore) {
  if (score.result === 'pass') return <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success" />
  if (score.result === 'skip') return <MinusCircle className="h-3.5 w-3.5 shrink-0 text-warning" />
  return <XCircle className="h-3.5 w-3.5 shrink-0 text-error" />
}

export function RunResultsCard({
  testCaseResults,
  testCases,
  isRunning,
  pendingCount = 0,
}: RunResultsCardProps) {
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set())

  const toggle = (index: number) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(index)) {
        next.delete(index)
      } else {
        next.add(index)
      }
      return next
    })
  }

  const totalCases = testCaseResults.length + pendingCount
  const passedCases = testCaseResults.filter((r) => r.passed === true).length
  const failedCases = testCaseResults.filter((r) => r.passed === false).length
  const inconclusiveCases = testCaseResults.filter((r) => r.passed == null).length
  const allPassed = passedCases === totalCases && totalCases > 0 && !isRunning
  const allInconclusive = inconclusiveCases === totalCases && totalCases > 0 && !isRunning
  const completedCount = testCaseResults.length
  const passPct = totalCases > 0 ? Math.round((passedCases / totalCases) * 100) : 0
  const failPct = totalCases > 0 ? Math.round((failedCases / totalCases) * 100) : 0
  const progressPct = totalCases > 0 ? Math.round((completedCount / totalCases) * 100) : 0

  const summaryVariant = isRunning
    ? 'warning'
    : allPassed
      ? 'success'
      : failedCases > 0
        ? 'error'
        : 'warning'

  return (
    <div className="space-y-4">
      {/* Summary bar */}
      <div
        className={cn(
          'group relative overflow-hidden rounded-2xl border bg-bg-elevated px-5 py-4',
          'transition-all duration-300',
          summaryVariant === 'success' &&
            'border-success/20 shadow-[0_0_30px_-10px_rgba(16,185,129,0.2)]',
          summaryVariant === 'warning' &&
            'border-warning/20 shadow-[0_0_30px_-10px_rgba(245,158,11,0.15)]',
          summaryVariant === 'error' &&
            'border-error/20 shadow-[0_0_30px_-10px_rgba(239,68,68,0.15)]',
        )}
      >
        {/* Ambient gradient */}
        <div
          className={cn(
            'pointer-events-none absolute inset-0 bg-gradient-to-r opacity-60',
            summaryVariant === 'success' && 'from-success/8 via-transparent to-transparent',
            summaryVariant === 'warning' && 'from-warning/8 via-transparent to-transparent',
            summaryVariant === 'error' && 'from-error/8 via-transparent to-transparent',
          )}
        />

        <div className="relative flex items-center gap-4">
          <div className="flex items-center gap-2">
            {summaryVariant === 'success' ? (
              <CheckCircle2 className="h-5 w-5 text-success" />
            ) : summaryVariant === 'warning' ? (
              <AlertTriangle className="h-5 w-5 text-warning" />
            ) : (
              <XCircle className="h-5 w-5 text-error" />
            )}
            <span className="font-display text-sm font-semibold text-fg-primary">
              {isRunning ? (
                <span className="text-fg-secondary">
                  Running {completedCount}/{totalCases} test cases...
                </span>
              ) : allInconclusive ? (
                <span className="text-warning">
                  {totalCases} test {totalCases === 1 ? 'case' : 'cases'} inconclusive
                </span>
              ) : (
                <>
                  {passedCases}/{totalCases} test cases passed
                  {inconclusiveCases > 0 ? (
                    <span className="ml-1 text-warning">({inconclusiveCases} inconclusive)</span>
                  ) : null}
                </>
              )}
            </span>
          </div>
          <div className="flex-1">
            <div className="flex h-2 overflow-hidden rounded-full bg-bg-subtle">
              {isRunning ? (
                <div
                  className="h-full animate-pulse rounded-full bg-gradient-to-r from-brand-500/80 to-brand-500 transition-all duration-500"
                  style={{ width: `${Math.max(progressPct, 3)}%` }}
                />
              ) : allInconclusive ? (
                <div className="h-full w-full rounded-full bg-gradient-to-r from-warning/80 to-warning" />
              ) : (
                <>
                  {passPct > 0 && (
                    <div
                      className="h-full bg-success transition-all duration-500"
                      style={{ width: `${passPct}%` }}
                    />
                  )}
                  {failPct > 0 && (
                    <div
                      className="h-full bg-error transition-all duration-500"
                      style={{ width: `${failPct}%` }}
                    />
                  )}
                </>
              )}
            </div>
          </div>
          <Badge
            variant={isRunning ? 'info' : summaryVariant}
            className={isRunning ? 'animate-pulse' : ''}
          >
            {isRunning ? `${progressPct}%` : allInconclusive ? 'Inconclusive' : `${passPct}%`}
          </Badge>
        </div>
      </div>

      {/* Per-test-case results */}
      <div className="space-y-2">
        {testCaseResults.map((result, index) => {
          const isExpanded = expandedIds.has(index)
          const name = getTestCaseName(result, testCases)
          const passedScores = result.scores.filter((s) => s.result === 'pass').length
          const skippedScores = result.scores.filter((s) => s.result === 'skip').length
          const totalScores = result.scores.length
          const allScoresSkipped = skippedScores === totalScores && totalScores > 0

          return (
            <div
              key={result.testCaseId ?? index}
              className={cn(
                'group/row overflow-hidden rounded-xl border bg-bg-elevated transition-all duration-200',
                result.passed === true
                  ? 'border-fg-subtle/10 hover:border-success/20'
                  : result.passed === false
                    ? 'border-fg-subtle/10 hover:border-error/20'
                    : 'border-fg-subtle/10 hover:border-warning/20',
                isExpanded && result.passed === false && 'border-error/15',
                isExpanded && result.passed === true && 'border-success/15',
                isExpanded && result.passed == null && 'border-warning/15',
              )}
              style={{ animationDelay: `${index * 40}ms` }}
            >
              <button
                type="button"
                onClick={() => toggle(index)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-bg-subtle/30"
              >
                {result.passed === true ? (
                  <CheckCircle2 className="h-5 w-5 shrink-0 text-success" />
                ) : result.passed === false ? (
                  <XCircle className="h-5 w-5 shrink-0 text-error" />
                ) : (
                  <AlertTriangle className="h-5 w-5 shrink-0 text-warning" />
                )}

                <span className="flex-1 text-sm font-medium text-fg-primary">{name}</span>

                <span className="text-xs text-fg-muted">
                  {allScoresSkipped
                    ? `${totalScores} skipped`
                    : `${passedScores}/${totalScores} evaluators passed`}
                </span>

                {isExpanded ? (
                  <ChevronUp className="h-4 w-4 text-fg-muted transition-transform" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-fg-muted transition-transform" />
                )}
              </button>

              {isExpanded ? (
                <div className="border-t border-fg-subtle/10 px-4 py-3 animate-fade-in">
                  {result.sessionId ? (
                    <div className="mb-3">
                      <Link
                        to="/sessions/$id"
                        params={{ id: result.sessionId }}
                        className="inline-flex items-center gap-1.5 text-xs text-fg-muted hover:text-brand-400 transition-colors"
                      >
                        <Radio className="h-3 w-3" />
                        Session {result.sessionId}
                      </Link>
                    </div>
                  ) : null}
                  {allScoresSkipped ? (
                    <div className="mb-3 flex items-center gap-2 rounded-lg border border-warning/20 bg-warning/5 px-3 py-2">
                      <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />
                      <p className="text-xs text-warning">
                        All evaluators were skipped — results are inconclusive.
                      </p>
                    </div>
                  ) : null}
                  <p className="mb-2 font-display text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
                    Score Breakdown:
                  </p>
                  <div className="space-y-0.5 rounded-lg border border-fg-subtle/10 bg-bg-base p-1.5">
                    {result.scores.map((score) => (
                      <div key={score.id}>
                        <div
                          className={cn(
                            'flex items-center gap-2 rounded-md px-2.5 py-2 text-xs transition-colors',
                            score.result === 'pass' && 'hover:bg-success/5',
                            score.result === 'skip' && 'hover:bg-warning/5',
                            (score.result === 'fail' || score.result === 'error') &&
                              'hover:bg-error/5',
                          )}
                        >
                          {scoreIcon(score)}
                          <span className="flex-1 font-mono text-fg-secondary">{score.name}</span>
                          <div className="flex items-center gap-1.5">
                            <Badge variant="info">{score.evaluatorType}</Badge>
                            {score.required ? <Badge variant="warning">required</Badge> : null}
                          </div>
                        </div>
                        {score.result !== 'pass' && score.reasoning ? (
                          <p className="ml-8 pb-1.5 text-xs text-fg-muted italic">
                            {score.reasoning}
                          </p>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          )
        })}
        {pendingCount > 0
          ? (['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const)
              .slice(0, Math.min(pendingCount, 8))
              .map((id, i) => (
                <div
                  key={`pending-${id}`}
                  className="overflow-hidden rounded-xl border border-fg-subtle/10 bg-bg-elevated opacity-50"
                >
                  <div className="flex w-full items-center gap-3 px-4 py-3">
                    <Loader2 className="h-5 w-5 shrink-0 animate-spin text-fg-muted" />
                    <span className="flex-1 text-sm text-fg-muted">
                      {i === 0
                        ? 'Waiting for simulation to complete...'
                        : 'Queued — will run after current test case'}
                    </span>
                    <span className="text-xs text-fg-muted">Pending</span>
                  </div>
                </div>
              ))
          : null}
      </div>
    </div>
  )
}
