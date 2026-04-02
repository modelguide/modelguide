import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, Outlet, createFileRoute, useMatch, useNavigate } from '@tanstack/react-router'
import {
  ArrowLeft,
  Bot,
  ExternalLink,
  FileText,
  FlaskConical,
  MoreVertical,
  Play,
  RefreshCw,
  Search,
  Trash2,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button } from '~/components/ui/button'
import { Dialog, DialogFooter } from '~/components/ui/dialog'
import { Spinner } from '~/components/ui/spinner'
import { EvaluateSessionDialog } from '~/features/evals/components/evaluate-session-dialog'
import { EvaluatorsPanel } from '~/features/evals/components/evaluators-panel'
import { GenerateTestCasesButton } from '~/features/evals/components/generate-test-cases-button'
import { SimulateRunDialog } from '~/features/evals/components/simulate-run-dialog'
import { SuiteRunsTable } from '~/features/evals/components/suite-runs-table'
import { TestCasesPanel } from '~/features/evals/components/test-cases-panel'
import { api } from '~/lib/api'
import { cn } from '~/lib/cn'
import type { PaginatedResponse } from '~/lib/pagination'
import { useIsAdmin } from '~/lib/permissions'
import type { Agent } from '~/schemas/agents'
import type { EvalSuiteDetail, EvalSuiteRun } from '~/schemas/eval-suites'
import type { SopDetail } from '~/schemas/sops'

export const Route = createFileRoute('/_authenticated/evals/suites/$suiteId')({
  component: SuiteDetailPage,
})

function SuiteDetailPage() {
  const { suiteId } = Route.useParams()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const isAdmin = useIsAdmin()
  const [activeTab, setActiveTab] = useState<'test-cases' | 'evaluators' | 'runs'>('test-cases')
  const [showEvalSessionDialog, setShowEvalSessionDialog] = useState(false)
  const [showSimulateRunDialog, setShowSimulateRunDialog] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [showReinitDialog, setShowReinitDialog] = useState(false)
  const [showOverflowMenu, setShowOverflowMenu] = useState(false)
  const [generatingRemaining, setGeneratingRemaining] = useState(0)
  const overflowRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!showOverflowMenu) return
    const handler = (e: MouseEvent) => {
      if (overflowRef.current && !overflowRef.current.contains(e.target as Node)) {
        setShowOverflowMenu(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showOverflowMenu])

  // If a child route (e.g. runs/$runId) is active, render it instead
  const childMatch = useMatch({
    from: '/_authenticated/evals/suites/$suiteId/runs/$runId',
    shouldThrow: false,
  })

  const {
    data: suite,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['eval-suites', suiteId],
    queryFn: () => api.get(`eval-suites/${suiteId}`).json<EvalSuiteDetail>(),
  })

  const { data: agent } = useQuery({
    queryKey: ['agents', suite?.agentId],
    queryFn: () => api.get(`agents/${suite?.agentId}`).json<Agent>(),
    enabled: !!suite?.agentId,
  })

  const { data: sop } = useQuery({
    queryKey: ['sops', suite?.sopId],
    queryFn: () => api.get(`sops/${suite?.sopId}`).json<SopDetail>(),
    enabled: !!suite?.sopId,
  })

  const { data: runsData, isLoading: runsLoading } = useQuery({
    queryKey: ['eval-suites', suiteId, 'runs'],
    queryFn: () => api.get(`eval-suites/${suiteId}/runs`).json<PaginatedResponse<EvalSuiteRun>>(),
  })

  const reinitMutation = useMutation({
    mutationFn: () =>
      api
        .post('eval-suites/init', { json: { agentId: suite?.agentId, sopId: suite?.sopId } })
        .json<EvalSuiteDetail>(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['eval-suites', suiteId] })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`eval-suites/${suiteId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['eval-suites'] })
      navigate({ to: '/evals' })
    },
  })

  if (childMatch) return <Outlet />

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4 animate-fade-up">
        <Link
          to="/evals"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-fg-secondary transition-colors hover:bg-bg-subtle hover:text-fg-primary"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            {suite ? <FlaskConical className="h-5 w-5 text-fg-secondary" /> : null}
            <h1 className="font-display text-2xl font-bold text-fg-primary">
              {suite?.name ?? 'Suite Detail'}
            </h1>
          </div>
          {suite?.description ? (
            <p className="mt-1 font-sans text-sm text-fg-secondary">{suite.description}</p>
          ) : null}
        </div>
        {isAdmin && suite ? (
          <div className="flex items-center gap-2">
            {suite.sopId ? (
              <GenerateTestCasesButton
                suiteId={suiteId}
                hasSop={!!suite.sopId}
                onProgress={setGeneratingRemaining}
              />
            ) : null}
            <Button variant="secondary" onClick={() => setShowEvalSessionDialog(true)}>
              <Search className="h-4 w-4" />
              Evaluate Session
            </Button>
            <Button onClick={() => setShowSimulateRunDialog(true)}>
              <Play className="h-4 w-4" />
              Simulate & Run
            </Button>
            <div className="relative" ref={overflowRef}>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setShowOverflowMenu(!showOverflowMenu)}
              >
                <MoreVertical className="h-4 w-4" />
              </Button>
              {showOverflowMenu ? (
                <div className="absolute -right-2 top-full z-50 mt-3 w-36 rounded-lg border border-fg-subtle/20 bg-bg-elevated p-1 shadow-lg">
                  <button
                    type="button"
                    onClick={() => {
                      setShowOverflowMenu(false)
                      reinitMutation.reset()
                      setShowReinitDialog(true)
                    }}
                    className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm text-fg-secondary hover:bg-bg-subtle disabled:opacity-50"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    Re-init
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowOverflowMenu(false)
                      deleteMutation.reset()
                      setShowDeleteDialog(true)
                    }}
                    className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm text-error hover:bg-error/10"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Delete
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      {/* Agent & SOP links */}
      {suite ? (
        <div className="flex items-center gap-4 text-sm">
          {agent ? (
            <Link
              to="/agents/$id"
              params={{ id: suite.agentId }}
              className="flex items-center gap-1.5 rounded-md border border-fg-subtle/10 bg-bg-elevated px-2 py-1 text-xs text-fg-secondary transition-colors hover:border-fg-subtle/20 hover:text-fg-primary"
            >
              <Bot className="h-3 w-3 text-fg-muted" />
              {agent.name}
              <ExternalLink className="h-2.5 w-2.5 text-fg-muted" />
            </Link>
          ) : null}
          {sop ? (
            <Link
              to="/sops/$id"
              params={{ id: suite.sopId ?? '' }}
              className="flex items-center gap-1.5 rounded-md border border-fg-subtle/10 bg-bg-elevated px-2 py-1 text-xs text-fg-secondary transition-colors hover:border-fg-subtle/20 hover:text-fg-primary"
            >
              <FileText className="h-3 w-3 text-fg-muted" />
              {sop.name}
              <ExternalLink className="h-2.5 w-2.5 text-fg-muted" />
            </Link>
          ) : null}
        </div>
      ) : null}

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Spinner size="lg" />
        </div>
      ) : error ? (
        <div className="rounded-lg border border-error/30 bg-error-muted p-6 text-center">
          <p className="text-sm text-error">Failed to load eval suite</p>
        </div>
      ) : suite ? (
        <>
          {/* Tabs */}
          <div className="flex gap-1 rounded-xl bg-bg-subtle p-1">
            <button
              type="button"
              onClick={() => setActiveTab('test-cases')}
              className={cn(
                'rounded-lg px-4 py-2 text-sm font-medium transition-colors',
                activeTab === 'test-cases'
                  ? 'bg-bg-elevated text-fg-primary shadow-sm'
                  : 'text-fg-secondary hover:text-fg-primary',
              )}
            >
              Test Cases
              {suite.testCases ? (
                <span className="ml-1.5 text-xs text-fg-muted">({suite.testCases.length})</span>
              ) : null}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('evaluators')}
              className={cn(
                'rounded-lg px-4 py-2 text-sm font-medium transition-colors',
                activeTab === 'evaluators'
                  ? 'bg-bg-elevated text-fg-primary shadow-sm'
                  : 'text-fg-secondary hover:text-fg-primary',
              )}
            >
              Evaluators
              {suite.evaluators ? (
                <span className="ml-1.5 text-xs text-fg-muted">({suite.evaluators.length})</span>
              ) : null}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('runs')}
              className={cn(
                'rounded-lg px-4 py-2 text-sm font-medium transition-colors',
                activeTab === 'runs'
                  ? 'bg-bg-elevated text-fg-primary shadow-sm'
                  : 'text-fg-secondary hover:text-fg-primary',
              )}
            >
              Runs
              {runsData ? (
                <span className="ml-1.5 text-xs text-fg-muted">
                  ({runsData.pagination.totalItems})
                </span>
              ) : null}
            </button>
          </div>

          {/* Tab Content */}
          {activeTab === 'test-cases' ? (
            <TestCasesPanel testCases={suite.testCases ?? []} pendingCount={generatingRemaining} />
          ) : activeTab === 'evaluators' ? (
            <EvaluatorsPanel evaluators={suite.evaluators ?? []} />
          ) : (
            <SuiteRunsTable runs={runsData?.data ?? []} suiteId={suiteId} isLoading={runsLoading} />
          )}
        </>
      ) : null}

      {/* Evaluate Session Dialog */}
      {isAdmin ? (
        <EvaluateSessionDialog
          open={showEvalSessionDialog}
          onClose={() => setShowEvalSessionDialog(false)}
          suiteId={suiteId}
          agentId={suite?.agentId}
          onSuccess={() => setActiveTab('runs')}
        />
      ) : null}

      {/* Simulate & Run Dialog */}
      {isAdmin ? (
        <SimulateRunDialog
          open={showSimulateRunDialog}
          onClose={() => setShowSimulateRunDialog(false)}
          suiteId={suiteId}
          testCases={suite?.testCases ?? []}
          onSuccess={(res) =>
            navigate({
              to: '/evals/suites/$suiteId/runs/$runId',
              params: { suiteId, runId: res.suiteRunId },
            })
          }
        />
      ) : null}

      {/* Re-init Confirmation Dialog */}
      <Dialog
        open={showReinitDialog}
        onClose={() => setShowReinitDialog(false)}
        title="Re-initialize Suite"
        description="This will regenerate all evaluators from the linked SOP and delete all existing test cases. Run history will be preserved. This action cannot be undone."
      >
        {reinitMutation.error ? (
          <p className="mb-3 text-xs text-error">
            Failed to re-initialize suite. Please try again.
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="secondary" onClick={() => setShowReinitDialog(false)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={() =>
              reinitMutation.mutate(undefined, {
                onSuccess: () => setShowReinitDialog(false),
              })
            }
            loading={reinitMutation.isPending}
          >
            Re-init
          </Button>
        </DialogFooter>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={showDeleteDialog}
        onClose={() => setShowDeleteDialog(false)}
        title="Delete Eval Suite"
        description="This will permanently delete this eval suite, all its test cases, assertions, and run history. This action cannot be undone."
      >
        {deleteMutation.error ? (
          <p className="mb-3 text-xs text-error">Failed to delete suite. Please try again.</p>
        ) : null}
        <DialogFooter>
          <Button variant="secondary" onClick={() => setShowDeleteDialog(false)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={() => deleteMutation.mutate()}
            loading={deleteMutation.isPending}
          >
            Delete
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  )
}
