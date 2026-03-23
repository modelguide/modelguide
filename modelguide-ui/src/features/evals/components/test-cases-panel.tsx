import { ChevronDown, ChevronUp } from 'lucide-react'
import { useState } from 'react'
import { Badge } from '~/components/ui/badge'
import { cn } from '~/lib/cn'
import type { EvalSuiteTestCase } from '~/schemas/eval-suites'

export interface TestCasesPanelProps {
  testCases: EvalSuiteTestCase[]
}

export function TestCasesPanel({ testCases }: TestCasesPanelProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())

  const toggle = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  if (testCases.length === 0) {
    return (
      <div className="rounded-lg border border-fg-subtle/10 bg-bg-elevated px-6 py-12 text-center">
        <p className="text-sm text-fg-muted">No test cases yet</p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {testCases.map((tc, index) => {
        const isExpanded = expandedIds.has(tc.id)
        return (
          <div
            key={tc.id}
            className={cn(
              'group/tc overflow-hidden rounded-xl border bg-bg-elevated transition-all duration-200',
              isExpanded
                ? 'border-brand-500/20 shadow-[0_0_20px_-8px_rgba(249,115,22,0.15)]'
                : 'border-fg-subtle/10 hover:border-fg-subtle/20',
            )}
            style={{ animationDelay: `${index * 40}ms` }}
          >
            <button
              type="button"
              onClick={() => toggle(tc.id)}
              className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-bg-subtle/30"
            >
              <span
                className={cn(
                  'flex h-6 w-6 shrink-0 items-center justify-center rounded-md font-mono text-[10px] font-medium transition-colors',
                  isExpanded
                    ? 'bg-brand-500/15 text-brand-500'
                    : 'bg-bg-subtle text-fg-muted group-hover/tc:bg-bg-subtle/80',
                )}
              >
                #{tc.order}
              </span>
              <span className="flex-1 text-sm font-medium text-fg-primary">{tc.name}</span>
              <Badge variant={tc.source === 'auto' ? 'info' : 'default'}>{tc.source}</Badge>
              <span className="text-xs text-fg-muted">
                {tc.evaluators.length} evaluator{tc.evaluators.length !== 1 ? 's' : ''}
              </span>
              {isExpanded ? (
                <ChevronUp className="h-4 w-4 text-fg-muted transition-transform" />
              ) : (
                <ChevronDown className="h-4 w-4 text-fg-muted transition-transform" />
              )}
            </button>

            {isExpanded ? (
              <div className="border-t border-fg-subtle/10 px-4 py-3 animate-fade-in">
                {tc.description ? (
                  <p className="mb-2 text-sm text-fg-secondary">{tc.description}</p>
                ) : null}

                {tc.expectedBehavior ? (
                  <div className="mb-2">
                    <span className="font-display text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
                      Expected:{' '}
                    </span>
                    <span className="text-xs text-fg-secondary">{tc.expectedBehavior}</span>
                  </div>
                ) : null}

                {tc.input ? (
                  <div className="mb-3">
                    <span className="font-display text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
                      Input:{' '}
                    </span>
                    <code className="font-mono text-xs text-fg-secondary">
                      {JSON.stringify(tc.input)}
                    </code>
                  </div>
                ) : null}

                {tc.evaluators.length > 0 ? (
                  <div>
                    <p className="mb-1.5 font-display text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
                      Evaluators:
                    </p>
                    <div className="space-y-0.5 rounded-lg border border-fg-subtle/10 bg-bg-base p-1.5">
                      {tc.evaluators.map((assertion) => (
                        <div
                          key={assertion.id}
                          className="flex items-center gap-2 rounded-md px-2.5 py-2 text-xs transition-colors hover:bg-bg-subtle/40"
                        >
                          <span className="flex-1 font-mono text-fg-secondary">
                            {assertion.name}
                          </span>
                          <Badge variant={assertion.source === 'auto' ? 'info' : 'default'}>
                            {assertion.source}
                          </Badge>
                          {assertion.required ? (
                            <Badge variant="warning">required</Badge>
                          ) : (
                            <span className="text-fg-muted">optional</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
