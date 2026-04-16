import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ChevronUp, Minus, Plus, Search, Undo2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { api } from '~/lib/api'
import { cn } from '~/lib/cn'
import type { EvalSuiteAssertion, EvalSuiteTestCase } from '~/schemas/eval-suites'
import { EvalConfigPickerDialog } from './eval-config-picker-dialog'

export interface TestCasesPanelProps {
  testCases: EvalSuiteTestCase[]
  suiteId: string
  evaluators?: EvalSuiteAssertion[]
  pendingCount?: number
  isAdmin?: boolean
}

type SourceFilter = 'all' | 'auto' | 'manual'

export function TestCasesPanel({
  testCases,
  suiteId,
  evaluators = [],
  pendingCount = 0,
  isAdmin = false,
}: TestCasesPanelProps) {
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

  if (testCases.length === 0 && pendingCount === 0) {
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
                  {(tc.evaluatorOverrides?.length ?? 0) > 0 ? (
                    <Badge variant="warning">
                      {tc.evaluatorOverrides?.length} override
                      {(tc.evaluatorOverrides?.length ?? 0) > 1 ? 's' : ''}
                    </Badge>
                  ) : null}
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

                    {/* Evaluator overrides section */}
                    {isAdmin ? (
                      <TestCaseEvaluatorOverrides
                        suiteId={suiteId}
                        testCase={tc}
                        suiteEvaluators={evaluators}
                      />
                    ) : null}
                  </div>
                ) : null}
              </div>
            )
          })}
          {/* Skeleton placeholders for cases being generated */}
          {pendingCount > 0
            ? (['a', 'b', 'c'] as const).slice(0, Math.min(pendingCount, 3)).map((id, i) => (
                <div
                  key={`skeleton-${id}`}
                  className="overflow-hidden rounded-xl border border-fg-subtle/10 bg-bg-elevated"
                  style={{ animationDelay: `${i * 80}ms` }}
                >
                  <div className="flex items-center gap-3 px-4 py-3">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-bg-subtle">
                      <span className="h-3 w-3 rounded-sm bg-fg-subtle/10 animate-pulse" />
                    </span>
                    <div className="flex-1 space-y-1.5">
                      <div
                        className="h-3.5 rounded bg-fg-subtle/10 animate-shimmer"
                        style={{ width: `${45 + ((i * 17) % 35)}%` }}
                      />
                    </div>
                    <div className="h-5 w-10 rounded bg-fg-subtle/10 animate-pulse" />
                  </div>
                </div>
              ))
            : null}
        </div>
      )}
    </div>
  )
}

// ============================================================================
// Test Case Evaluator Overrides sub-component (AC 18-20)
// ============================================================================

interface TestCaseEvaluatorOverridesProps {
  suiteId: string
  testCase: EvalSuiteTestCase
  suiteEvaluators: EvalSuiteAssertion[]
}

function TestCaseEvaluatorOverrides({
  suiteId,
  testCase,
  suiteEvaluators,
}: TestCaseEvaluatorOverridesProps) {
  const queryClient = useQueryClient()
  const [showPicker, setShowPicker] = useState(false)
  const overrides = testCase.evaluatorOverrides ?? []

  const excludedConfigIds = new Set(
    overrides.filter((o) => o.overrideType === 'exclude').map((o) => o.evalConfigId),
  )
  const addOverrides = overrides.filter((o) => o.overrideType === 'add')

  // Create exclude override
  const excludeMutation = useMutation({
    mutationFn: (data: { evalConfigId: string; name: string }) =>
      api
        .post(`eval-suites/${suiteId}/test-cases/${testCase.id}/evaluators`, {
          json: { evalConfigId: data.evalConfigId, overrideType: 'exclude', name: data.name },
        })
        .json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['eval-suites', suiteId] })
    },
  })

  // Delete override (undo exclude or remove add)
  const deleteOverrideMutation = useMutation({
    mutationFn: (overrideId: string) =>
      api.delete(`eval-suites/${suiteId}/test-cases/${testCase.id}/evaluators/${overrideId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['eval-suites', suiteId] })
    },
  })

  // Create add override
  const addMutation = useMutation({
    mutationFn: (data: { evalConfigId: string; name: string }) =>
      api
        .post(`eval-suites/${suiteId}/test-cases/${testCase.id}/evaluators`, {
          json: { evalConfigId: data.evalConfigId, overrideType: 'add', name: data.name },
        })
        .json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['eval-suites', suiteId] })
      setShowPicker(false)
    },
  })

  return (
    <div className="mt-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="font-display text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
          Evaluators
        </span>
        <Button variant="ghost" size="sm" onClick={() => setShowPicker(true)}>
          <Plus className="h-3 w-3" />
          Add
        </Button>
      </div>

      {/* Inherited evaluators */}
      {suiteEvaluators.length > 0 ? (
        <div className="space-y-0.5 rounded-lg border border-fg-subtle/10 bg-bg-base p-1">
          {suiteEvaluators.map((se) => {
            const isExcluded = excludedConfigIds.has(se.evalConfigId)
            const excludeOverride = overrides.find(
              (o) => o.evalConfigId === se.evalConfigId && o.overrideType === 'exclude',
            )

            return (
              <div
                key={se.id}
                className={cn(
                  'flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs transition-colors',
                  isExcluded ? 'opacity-50' : 'hover:bg-bg-subtle/30',
                )}
              >
                <span
                  className={cn('flex-1 font-mono text-fg-secondary', isExcluded && 'line-through')}
                >
                  {se.name}
                </span>
                <Badge variant="default">inherited</Badge>
                {isExcluded && excludeOverride ? (
                  <button
                    type="button"
                    onClick={() => deleteOverrideMutation.mutate(excludeOverride.id)}
                    className="rounded p-0.5 text-brand-400 hover:bg-brand-500/10"
                    title="Undo exclude"
                  >
                    <Undo2 className="h-3 w-3" />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() =>
                      excludeMutation.mutate({
                        evalConfigId: se.evalConfigId,
                        name: se.name,
                      })
                    }
                    className="rounded p-0.5 text-fg-muted opacity-0 transition-opacity hover:text-error group-hover/tc:opacity-100"
                    title="Exclude for this test case"
                  >
                    <Minus className="h-3 w-3" />
                  </button>
                )}
              </div>
            )
          })}
        </div>
      ) : null}

      {/* Case-level add overrides */}
      {addOverrides.length > 0 ? (
        <div className="space-y-0.5 rounded-lg border border-brand-500/20 bg-bg-base p-1">
          <span className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-brand-400">
            Case-specific
          </span>
          {addOverrides.map((ao) => (
            <div
              key={ao.id}
              className="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs hover:bg-bg-subtle/30"
            >
              <span className="flex-1 font-mono text-fg-secondary">{ao.name}</span>
              <button
                type="button"
                onClick={() => deleteOverrideMutation.mutate(ao.id)}
                className="rounded p-0.5 text-fg-muted hover:text-error"
                title="Remove override"
              >
                <Minus className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {/* Eval config picker for adding */}
      <EvalConfigPickerDialog
        open={showPicker}
        onClose={() => setShowPicker(false)}
        onSelect={(config) => {
          addMutation.mutate({ evalConfigId: config.id, name: config.name })
        }}
      />
    </div>
  )
}
