import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, Outlet, createFileRoute, useMatch, useNavigate } from '@tanstack/react-router'
import { ArrowLeft, Bot, FileText, FlaskConical, Play, RefreshCw, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Dialog, DialogFooter } from '~/components/ui/dialog'
import { Spinner } from '~/components/ui/spinner'
import { GenerateTestCasesButton } from '~/features/evals/components/generate-test-cases-button'
import { RunSuiteDialog } from '~/features/evals/components/run-suite-dialog'
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
  const [activeTab, setActiveTab] = useState<'test-cases' | 'runs'>('test-cases')
  const [showRunDialog, setShowRunDialog] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)

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
            <h1 className="font-display text-2xl font-bold text-fg-primary">
              {suite?.name ?? 'Suite Detail'}
            </h1>
            {suite ? (
              <Badge variant="info">
                <FlaskConical className="h-3 w-3" />
                eval suite
              </Badge>
            ) : null}
          </div>
          {suite?.description ? (
            <p className="mt-1 font-sans text-sm text-fg-secondary">{suite.description}</p>
          ) : null}
        </div>
        {isAdmin && suite ? (
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              onClick={() => reinitMutation.mutate()}
              loading={reinitMutation.isPending}
              title="Re-generate test cases and evaluators from SOP"
            >
              <RefreshCw className="h-4 w-4" />
              Re-init
            </Button>
            {suite.sopId ? (
              <GenerateTestCasesButton suiteId={suiteId} hasSop={!!suite.sopId} />
            ) : null}
            <Button onClick={() => setShowRunDialog(true)}>
              <Play className="h-4 w-4" />
              Run Suite
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                deleteMutation.reset()
                setShowDeleteDialog(true)
              }}
            >
              <Trash2 className="h-4 w-4" />
              Delete
            </Button>
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
              className="flex items-center gap-1.5 rounded-lg border border-fg-subtle/10 bg-bg-elevated px-3 py-1.5 text-fg-secondary transition-colors hover:border-fg-subtle/20 hover:text-fg-primary"
            >
              <Bot className="h-3.5 w-3.5 text-fg-muted" />
              {agent.name}
            </Link>
          ) : null}
          {sop ? (
            <Link
              to="/sops/$id"
              params={{ id: suite.sopId ?? '' }}
              className="flex items-center gap-1.5 rounded-lg border border-fg-subtle/10 bg-bg-elevated px-3 py-1.5 text-fg-secondary transition-colors hover:border-fg-subtle/20 hover:text-fg-primary"
            >
              <FileText className="h-3.5 w-3.5 text-fg-muted" />
              {sop.name}
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
            <TestCasesPanel testCases={suite.testCases ?? []} />
          ) : (
            <SuiteRunsTable runs={runsData?.data ?? []} suiteId={suiteId} isLoading={runsLoading} />
          )}
        </>
      ) : null}

      {/* Run Suite Dialog */}
      {isAdmin ? (
        <RunSuiteDialog
          open={showRunDialog}
          onClose={() => setShowRunDialog(false)}
          suiteId={suiteId}
          agentId={suite?.agentId}
          onSuccess={() => setActiveTab('runs')}
        />
      ) : null}

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
