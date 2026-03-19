import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  MinusCircle,
  XCircle,
} from 'lucide-react'
import { useState } from 'react'
import { Badge } from '~/components/ui/badge'
import { cn } from '~/lib/cn'
import type { EvalRunScore, EvalSuiteTestCase, TestCaseResult } from '~/schemas/eval-suites'

export interface RunResultsCardProps {
  testCaseResults: TestCaseResult[]
  testCases?: EvalSuiteTestCase[]
}

function getTestCaseName(result: TestCaseResult, testCases?: EvalSuiteTestCase[]): string {
  // Prefer the name returned directly in the run result
  if (result.testCaseName) return result.testCaseName
  // Fallback: look up from suite test cases
  if (result.testCaseId && testCases) {
    const tc = testCases.find((t) => t.id === result.testCaseId)
    if (tc) return tc.name
  }
  return 'Unknown Test Case'
}

function scoreIcon(score: EvalRunScore) {
  if (score.result === 'pass') return <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success" />
  if (score.result === 'skip') return <MinusCircle className="h-3.5 w-3.5 shrink-0 text-warning" />
  return <XCircle className="h-3.5 w-3.5 shrink-0 text-error" />
}

function scoreResultVariant(result: string): 'success' | 'error' | 'warning' | 'default' {
  if (result === 'pass') return 'success'
  if (result === 'skip') return 'warning'
  return 'error'
}

export function RunResultsCard({ testCaseResults, testCases }: RunResultsCardProps) {
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

  const totalCases = testCaseResults.length
  const passedCases = testCaseResults.filter((r) => r.passed === true).length
  const failedCases = testCaseResults.filter((r) => r.passed === false).length
  const inconclusiveCases = testCaseResults.filter((r) => r.passed == null).length
  const allPassed = passedCases === totalCases && totalCases > 0
  const allInconclusive = inconclusiveCases === totalCases && totalCases > 0
  const pct = totalCases > 0 ? Math.round((passedCases / totalCases) * 100) : 0

  const summaryVariant = allPassed ? 'success' : failedCases > 0 ? 'error' : 'warning'

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
              {allInconclusive ? (
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
            <div className="h-2 overflow-hidden rounded-full bg-bg-subtle">
              <div
                className={cn(
                  'h-full rounded-full transition-all duration-500',
                  summaryVariant === 'success' && 'bg-gradient-to-r from-success/80 to-success',
                  summaryVariant === 'warning' && 'bg-gradient-to-r from-warning/80 to-warning',
                  summaryVariant === 'error' && 'bg-gradient-to-r from-error/80 to-error',
                )}
                style={{ width: allInconclusive ? '100%' : `${pct}%` }}
              />
            </div>
          </div>
          <Badge variant={summaryVariant}>{allInconclusive ? 'Inconclusive' : `${pct}%`}</Badge>
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
                          <Badge variant="info">{score.evaluatorType}</Badge>
                          {score.required ? <Badge variant="warning">required</Badge> : null}
                          <Badge variant={scoreResultVariant(score.result)}>{score.result}</Badge>
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
      </div>
    </div>
  )
}
