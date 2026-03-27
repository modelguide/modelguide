import { ChevronDown, ChevronUp, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Badge } from '~/components/ui/badge'
import { cn } from '~/lib/cn'
import type { EvalSuiteTestCase } from '~/schemas/eval-suites'

export interface TestCasesPanelProps {
  testCases: EvalSuiteTestCase[]
}

type SourceFilter = 'all' | 'auto' | 'manual'

export function TestCasesPanel({ testCases }: TestCasesPanelProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all')
  const [searchQuery, setSearchQuery] = useState('')

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

  const filteredTestCases = useMemo(() => {
    let result = testCases
    if (sourceFilter !== 'all') {
      result = result.filter((tc) => tc.source === sourceFilter)
    }
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase()
      result = result.filter((tc) => tc.name.toLowerCase().includes(q))
    }
    return result
  }, [testCases, sourceFilter, searchQuery])

  if (testCases.length === 0) {
    return (
      <div className="rounded-lg border border-fg-subtle/10 bg-bg-elevated px-6 py-12 text-center">
        <p className="text-sm text-fg-muted">No test cases yet</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-muted" />
          <input
            type="text"
            placeholder="Search test cases..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-lg border border-fg-subtle/10 bg-bg-subtle py-2 pl-9 pr-3 text-sm text-fg-primary placeholder:text-fg-muted focus:border-brand-500/30 focus:outline-none"
          />
        </div>
        <div className="flex gap-1 rounded-lg bg-bg-subtle p-0.5">
          {(['all', 'auto', 'manual'] as const).map((filter) => (
            <button
              key={filter}
              type="button"
              onClick={() => setSourceFilter(filter)}
              className={cn(
                'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                sourceFilter === filter
                  ? 'bg-bg-elevated text-fg-primary shadow-sm'
                  : 'text-fg-secondary hover:text-fg-primary',
              )}
            >
              {filter === 'all' ? 'All' : filter === 'auto' ? 'Auto' : 'Manual'}
            </button>
          ))}
        </div>
      </div>

      {/* Results */}
      {filteredTestCases.length === 0 ? (
        <div className="rounded-lg border border-fg-subtle/10 bg-bg-elevated px-6 py-8 text-center">
          <p className="text-sm text-fg-muted">No test cases match your filters</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filteredTestCases.map((tc, index) => {
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
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
