import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import {
  ChevronDown,
  ChevronUp,
  ExternalLink,
  FlaskConical,
  Minus,
  Pencil,
  Plus,
  Search,
  Undo2,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { InlineEditableText } from '~/components/ui/inline-editable-text'
import { Transcript } from '~/features/sessions/components/transcript'
import { api } from '~/lib/api'
import { cn } from '~/lib/cn'
import type { PaginatedResponse } from '~/lib/pagination'
import { formatDate } from '~/lib/utils'
import type {
  EvalRunSummary,
  EvalSuiteAssertion,
  EvalSuiteTestCase,
  RecordedTestCaseInput,
} from '~/schemas/eval-suites'
import type { SessionMessage } from '~/schemas/sessions'
import type { EvalConfigForEdit } from './eval-config-edit-dialog'
import { EvalConfigEditDialog } from './eval-config-edit-dialog'
import { EvalConfigPickerDialog } from './eval-config-picker-dialog'

const EVALUATOR_TYPE_LABELS: Record<string, string> = {
  tool_called: 'Tool Called',
  tool_input_contains: 'Tool Input',
  no_tool_called: 'No Tool',
  llm_judge: 'LLM Judge',
}

const EVALUATOR_TYPE_BADGE: Record<string, 'info' | 'success' | 'warning' | 'default'> = {
  tool_called: 'success',
  tool_input_contains: 'info',
  no_tool_called: 'warning',
  llm_judge: 'default',
}

export interface TestCasesPanelProps {
  testCases: EvalSuiteTestCase[]
  suiteId: string
  agentId?: string
  evaluators?: EvalSuiteAssertion[]
  pendingCount?: number
  isAdmin?: boolean
}

type SourceFilter = 'all' | 'auto' | 'manual' | 'recorded'

export function TestCasesPanel({
  testCases,
  suiteId,
  agentId,
  evaluators = [],
  pendingCount = 0,
  isAdmin = false,
}: TestCasesPanelProps) {
  const queryClient = useQueryClient()
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all')
  const [searchQuery, setSearchQuery] = useState('')

  const updateTestCaseMutation = useMutation({
    mutationFn: (data: { caseId: string; name: string }) =>
      api.patch(`eval-suites/${suiteId}/test-cases/${data.caseId}`, { json: { name: data.name } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['eval-suites', suiteId] })
    },
  })

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
          {(['all', 'auto', 'manual', 'recorded'] as const).map((filter) => {
            const labels: Record<SourceFilter, string> = {
              all: 'All',
              auto: 'Auto',
              manual: 'Manual',
              recorded: 'Recorded',
            }
            return (
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
                {labels[filter]}
              </button>
            )
          })}
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
                  {isAdmin ? (
                    <span
                      className="flex-1"
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => e.stopPropagation()}
                    >
                      <InlineEditableText
                        value={tc.name}
                        onSave={(name) => updateTestCaseMutation.mutate({ caseId: tc.id, name })}
                        className="text-sm font-medium text-fg-primary"
                        inputClassName="text-sm font-medium"
                      />
                    </span>
                  ) : (
                    <span className="flex-1 text-sm font-medium text-fg-primary">{tc.name}</span>
                  )}
                  {(tc.evaluatorOverrides?.length ?? 0) > 0 ? (
                    <Badge variant="warning">
                      {tc.evaluatorOverrides?.length} override
                      {(tc.evaluatorOverrides?.length ?? 0) > 1 ? 's' : ''}
                    </Badge>
                  ) : null}
                  <Badge
                    variant={
                      tc.source === 'auto'
                        ? 'info'
                        : tc.source === 'recorded'
                          ? 'warning'
                          : 'default'
                    }
                  >
                    {tc.source}
                  </Badge>
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

                    {tc.source === 'recorded' ? (
                      <RecordedTestCaseContent input={tc.input as RecordedTestCaseInput | null} />
                    ) : tc.input ? (
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
                        agentId={agentId}
                        testCase={tc}
                        suiteEvaluators={evaluators}
                      />
                    ) : null}

                    {/* Run history + Re-run */}
                    <TestCaseRunHistory suiteId={suiteId} testCase={tc} isAdmin={isAdmin} />
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
// Test case run history + Run Against Session (AC 31-32)
// ============================================================================

function TestCaseRunHistory({
  suiteId,
  testCase,
  isAdmin,
}: {
  suiteId: string
  testCase: EvalSuiteTestCase
  isAdmin: boolean
}) {
  const queryClient = useQueryClient()

  // Fetch past runs for this test case
  const runsQuery = useQuery({
    queryKey: ['eval-runs', { testCaseId: testCase.id }],
    queryFn: () =>
      api
        .get('evals/runs', { searchParams: { testCaseId: testCase.id, pageSize: '5' } })
        .json<PaginatedResponse<EvalRunSummary>>(),
  })

  // Determine the session ID for re-runs
  const recordedInput =
    testCase.source === 'recorded' ? (testCase.input as RecordedTestCaseInput | null) : null
  const rerunSessionId = recordedInput?.sessionId ?? runsQuery.data?.data?.[0]?.sessionId
  const canRerun = !!rerunSessionId

  // Re-run mutation
  const rerunMutation = useMutation({
    mutationFn: () =>
      api
        .post(`eval-suites/${suiteId}/test-cases/${testCase.id}/run`, {
          json: { sessionId: rerunSessionId, promptSource: 'compiled' },
        })
        .json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['eval-runs', { testCaseId: testCase.id }] })
    },
  })

  const runs = runsQuery.data?.data ?? []

  return (
    <div className="mt-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="font-display text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
          Run History
        </span>
        {isAdmin && canRerun ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => rerunMutation.mutate()}
            loading={rerunMutation.isPending}
          >
            <FlaskConical className="h-3 w-3" />
            Re-run
          </Button>
        ) : null}
      </div>

      {/* Past runs list */}
      {runs.length > 0 ? (
        <div className="space-y-0.5 rounded-lg border border-fg-subtle/10 bg-bg-base p-1">
          {runs.map((run) => {
            const isOwnTranscript =
              testCase.source === 'recorded' && recordedInput?.sessionId === run.sessionId

            return (
              <div
                key={run.id}
                className="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs text-fg-secondary"
              >
                <Badge
                  variant={run.passed ? 'success' : run.passed === false ? 'error' : 'default'}
                >
                  {run.passed ? 'pass' : run.passed === false ? 'fail' : run.status}
                </Badge>
                {isOwnTranscript ? (
                  <span className="flex-1 text-fg-muted truncate">Own transcript</span>
                ) : (
                  <Link
                    to="/sessions/$id"
                    params={{ id: run.sessionId }}
                    className="flex-1 font-mono text-brand-500 hover:text-brand-400 truncate transition-colors"
                  >
                    Session {run.sessionId.slice(0, 8)}
                  </Link>
                )}
                <span className="text-fg-muted">
                  {formatDate(run.createdAt, { format: 'relative' })}
                </span>
              </div>
            )
          })}
        </div>
      ) : (
        <p className="text-xs text-fg-muted">No runs yet</p>
      )}
    </div>
  )
}

// ============================================================================
// Recorded test case content (AC 20-22)
// ============================================================================

function RecordedTestCaseContent({ input }: { input: RecordedTestCaseInput | null }) {
  const [showTranscript, setShowTranscript] = useState(false)
  const clonedSessionId = input?.sessionId
  const originalSessionId = input?.originalSessionId

  const messagesQuery = useQuery({
    queryKey: ['sessions', clonedSessionId],
    queryFn: () => api.get(`sessions/${clonedSessionId}`).json<{ messages: SessionMessage[] }>(),
    enabled: showTranscript && !!clonedSessionId,
  })

  // Check if original session still exists
  const originalSessionQuery = useQuery({
    queryKey: ['session-exists', originalSessionId],
    queryFn: () => api.get(`sessions/${originalSessionId}`).json(),
    enabled: !!originalSessionId,
    retry: false,
  })

  return (
    <div className="mb-3 space-y-2">
      {/* Original session link (AC 22) */}
      <div className="flex items-center gap-2">
        <span className="font-display text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
          Source session:{' '}
        </span>
        {originalSessionId ? (
          originalSessionQuery.isError ? (
            <span className="text-xs text-fg-muted italic">Original session removed</span>
          ) : (
            <Link
              to="/sessions/$id"
              params={{ id: originalSessionId }}
              className="inline-flex items-center gap-1 text-xs text-brand-500 hover:text-brand-400"
            >
              View original
              <ExternalLink className="h-3 w-3" />
            </Link>
          )
        ) : null}
      </div>

      {/* Collapsible transcript (AC 20) */}
      <button
        type="button"
        onClick={() => setShowTranscript(!showTranscript)}
        className="flex items-center gap-1.5 text-xs text-fg-secondary hover:text-fg-primary transition-colors"
      >
        {showTranscript ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        {showTranscript ? 'Hide transcript' : 'Show transcript'}
      </button>

      {showTranscript ? (
        <div className="max-h-80 overflow-y-auto rounded-lg border border-fg-subtle/10 bg-bg-base p-3">
          {messagesQuery.isLoading ? (
            <div className="flex justify-center py-4">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
            </div>
          ) : messagesQuery.data?.messages ? (
            <Transcript messages={messagesQuery.data.messages} />
          ) : (
            <p className="text-xs text-fg-muted text-center py-4">No messages available</p>
          )}
        </div>
      ) : null}
    </div>
  )
}

// ============================================================================
// Test Case Evaluator Overrides sub-component (AC 18-20, AC-28, AC-29, AC-30)
// ============================================================================

interface TestCaseEvaluatorOverridesProps {
  suiteId: string
  agentId?: string
  testCase: EvalSuiteTestCase
  suiteEvaluators: EvalSuiteAssertion[]
}

function TestCaseEvaluatorOverrides({
  suiteId,
  agentId,
  testCase,
  suiteEvaluators,
}: TestCaseEvaluatorOverridesProps) {
  const queryClient = useQueryClient()
  const [showPicker, setShowPicker] = useState(false)
  const [editTarget, setEditTarget] = useState<EvalConfigForEdit | null>(null)
  /** true when editing a clone already pinned to this test case (global save is safe) */
  const [isEditingClone, setIsEditingClone] = useState(false)
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

  // AC-30: clone config and add as new override on this test case.
  // Note: these are two sequential API calls with no server-side transaction. If the
  // second call (POST evaluators) fails, the cloned eval_config is left orphaned with
  // no override pointing to it. Cleanup of unreferenced configs is a future task.
  const cloneMutation = useMutation({
    mutationFn: async ({ sourceConfig }: { sourceConfig: EvalConfigForEdit }) => {
      const cloned = await api
        .post('eval-configs', {
          json: {
            name: `Cloned - ${sourceConfig.name}`,
            evaluatorType: sourceConfig.evaluatorType,
            config: sourceConfig.config,
          },
        })
        .json<EvalConfigForEdit>()

      // Pin the clone to this test case as a new "add" override
      await api
        .post(`eval-suites/${suiteId}/test-cases/${testCase.id}/evaluators`, {
          json: { evalConfigId: cloned.id, overrideType: 'add', name: cloned.name },
        })
        .json()

      return cloned
    },
    onSuccess: (cloned) => {
      queryClient.invalidateQueries({ queryKey: ['eval-suites', suiteId] })
      queryClient.invalidateQueries({ queryKey: ['eval-configs'] })
      // Reopen edit dialog with the private clone — now "Save globally" is safe
      setEditTarget({
        id: cloned.id,
        name: cloned.name,
        description: cloned.description ?? null,
        evaluatorType: cloned.evaluatorType,
        config: cloned.config,
        tags: cloned.tags ?? [],
      })
      setIsEditingClone(true)
    },
  })

  function openEditDialog(
    evaluator: {
      evalConfigId: string
      name: string
      evaluatorType?: string | null
      config?: Record<string, unknown> | null
      tags?: string[]
    },
    isPrivate: boolean,
  ) {
    if (!evaluator.evaluatorType || !evaluator.config) return
    setEditTarget({
      id: evaluator.evalConfigId,
      name: evaluator.name,
      description: null,
      evaluatorType: evaluator.evaluatorType,
      config: evaluator.config as Record<string, unknown>,
      tags: evaluator.tags ?? [],
    })
    setIsEditingClone(isPrivate)
  }

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
                  'group/row flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs transition-colors',
                  isExcluded ? 'opacity-50' : 'hover:bg-bg-subtle/30',
                )}
              >
                <span
                  className={cn('flex-1 font-mono text-fg-secondary', isExcluded && 'line-through')}
                >
                  {se.name}
                </span>
                {/* AC-28: type badge on inherited row — clickable to edit */}
                {se.evaluatorType ? (
                  <button
                    type="button"
                    onClick={() => openEditDialog(se, false)}
                    title="Edit evaluator config"
                    className="cursor-pointer"
                  >
                    <Badge variant={EVALUATOR_TYPE_BADGE[se.evaluatorType] ?? 'default'}>
                      {EVALUATOR_TYPE_LABELS[se.evaluatorType] ?? se.evaluatorType}
                    </Badge>
                  </button>
                ) : null}
                <Badge variant="default">inherited</Badge>
                {!isExcluded && se.evaluatorType ? (
                  <button
                    type="button"
                    onClick={() => openEditDialog(se, false)}
                    className="rounded p-0.5 text-fg-muted opacity-0 transition-opacity hover:text-fg-primary group-hover/row:opacity-100"
                    title="Edit config"
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                ) : null}
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
              className="group/row flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs hover:bg-bg-subtle/30"
            >
              <span className="flex-1 font-mono text-fg-secondary">{ao.name}</span>
              {/* AC-28: type badge on case-specific row */}
              {ao.evaluatorType ? (
                <button
                  type="button"
                  onClick={() => openEditDialog(ao, true)}
                  title="Edit evaluator config"
                  className="cursor-pointer"
                >
                  <Badge variant={EVALUATOR_TYPE_BADGE[ao.evaluatorType] ?? 'default'}>
                    {EVALUATOR_TYPE_LABELS[ao.evaluatorType] ?? ao.evaluatorType}
                  </Badge>
                </button>
              ) : null}
              {ao.evaluatorType ? (
                <button
                  type="button"
                  onClick={() => openEditDialog(ao, true)}
                  className="rounded p-0.5 text-fg-muted opacity-0 transition-opacity hover:text-fg-primary group-hover/row:opacity-100"
                  title="Edit config"
                >
                  <Pencil className="h-3 w-3" />
                </button>
              ) : null}
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
        agentId={agentId}
        onSelect={(config) => {
          addMutation.mutate({ evalConfigId: config.id, name: config.name })
        }}
      />

      {/* Edit dialog for test-case evaluators:
          - inherited eval → clone-only (no save)
          - case-specific / post-clone → save-only (no clone) */}
      <EvalConfigEditDialog
        open={!!editTarget}
        onClose={() => {
          setEditTarget(null)
          setIsEditingClone(false)
        }}
        config={editTarget}
        onSaved={
          isEditingClone
            ? () => {
                setEditTarget(null)
                setIsEditingClone(false)
              }
            : undefined
        }
        warning={
          !isEditingClone
            ? 'This config is shared. Clone it to create a private copy for this test case.'
            : undefined
        }
        onClone={
          !isEditingClone ? (sourceConfig) => cloneMutation.mutate({ sourceConfig }) : undefined
        }
      />
    </div>
  )
}
