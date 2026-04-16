import { useMutation, useQuery } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Dialog, DialogFooter } from '~/components/ui/dialog'
import { api } from '~/lib/api'
import { cn } from '~/lib/cn'
import type { PaginatedResponse } from '~/lib/pagination'
import type { EvalSuiteDetail, EvalSuiteSummary, EvalSuiteTestCase } from '~/schemas/eval-suites'

interface EvalRunScore {
  name: string
  evaluatorType: string
  result: 'pass' | 'fail' | 'skip' | 'error'
  reasoning: string
  required: boolean
}

interface EvalRunResult {
  id: string
  passed: boolean | null
  scores: EvalRunScore[]
}

export interface RunAgainstTestCaseDialogProps {
  open: boolean
  onClose: () => void
  sessionId: string
  agentId: string
}

export function RunAgainstTestCaseDialog({
  open,
  onClose,
  sessionId,
  agentId,
}: RunAgainstTestCaseDialogProps) {
  const [selectedSuiteId, setSelectedSuiteId] = useState('')
  const [selectedCaseId, setSelectedCaseId] = useState('')
  const [step, setStep] = useState<'suite' | 'case'>('suite')
  const [result, setResult] = useState<EvalRunResult | null>(null)

  const { data: suitesData, isLoading: suitesLoading } = useQuery({
    queryKey: ['eval-suites', { agentId }],
    queryFn: () =>
      api
        .get('eval-suites', { searchParams: { agentId, pageSize: '50' } })
        .json<PaginatedResponse<EvalSuiteSummary>>(),
    enabled: open && !!agentId,
  })

  const { data: suiteDetail, isLoading: suiteDetailLoading } = useQuery({
    queryKey: ['eval-suites', selectedSuiteId],
    queryFn: () => api.get(`eval-suites/${selectedSuiteId}`).json<EvalSuiteDetail>(),
    enabled: step === 'case' && !!selectedSuiteId,
  })

  const runMutation = useMutation({
    mutationFn: () =>
      api
        .post(`eval-suites/${selectedSuiteId}/test-cases/${selectedCaseId}/run`, {
          json: { sessionId, promptSource: 'compiled' },
        })
        .json<EvalRunResult>(),
    onSuccess: (data) => {
      setResult(data)
    },
    onError: () => {
      toast.error('Failed to run test case')
    },
  })

  function resetState() {
    setSelectedSuiteId('')
    setSelectedCaseId('')
    setStep('suite')
    setResult(null)
  }

  function handleClose() {
    onClose()
    resetState()
  }

  function selectSuite(suiteId: string) {
    setSelectedSuiteId(suiteId)
    setSelectedCaseId('')
    setStep('case')
  }

  const suites = suitesData?.data ?? []
  const testCases = suiteDetail?.testCases ?? []

  const resultBadgeVariant = (r: EvalRunScore['result']) => {
    switch (r) {
      case 'pass':
        return 'success' as const
      case 'fail':
        return 'error' as const
      case 'error':
        return 'warning' as const
      default:
        return 'default' as const
    }
  }

  if (result) {
    const passedCount = result.scores.filter((s) => s.result === 'pass').length
    return (
      <Dialog
        open={open}
        onClose={handleClose}
        title="Run Against Test Case"
        description="Evaluation results"
      >
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <Badge
              variant={result.passed ? 'success' : result.passed === false ? 'error' : 'default'}
            >
              {result.passed ? 'Passed' : result.passed === false ? 'Failed' : 'Inconclusive'}
            </Badge>
            <span className="text-xs text-fg-muted">
              {passedCount}/{result.scores.length} evaluators passed
            </span>
          </div>
          <div className="space-y-1 rounded-lg border border-fg-subtle/10 bg-bg-base p-1.5">
            {result.scores.map((score) => (
              <details
                key={score.name}
                className="rounded-md px-2.5 py-1.5 text-xs hover:bg-bg-subtle/30"
              >
                <summary className="flex cursor-pointer items-center gap-2">
                  <span className="flex-1 font-mono text-fg-secondary">{score.name}</span>
                  {score.required ? (
                    <span className="text-[10px] text-fg-muted">required</span>
                  ) : null}
                  <Badge variant={resultBadgeVariant(score.result)}>{score.result}</Badge>
                </summary>
                {score.reasoning ? (
                  <p className="mt-1.5 whitespace-pre-wrap text-xs text-fg-muted pl-1">
                    {score.reasoning}
                  </p>
                ) : null}
              </details>
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={handleClose}>
            Done
          </Button>
        </DialogFooter>
      </Dialog>
    )
  }

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      title="Run Against Test Case"
      description="Select a test case to run its evaluators against this session."
    >
      <div className="space-y-4">
        {step === 'suite' ? (
          <div>
            <p className="mb-2 text-xs font-medium text-fg-muted">Select Suite</p>
            {suitesLoading ? (
              <div className="rounded-lg border border-fg-subtle/10 bg-bg-base p-4 text-center text-xs text-fg-muted">
                Loading suites...
              </div>
            ) : suites.length === 0 ? (
              <div className="rounded-lg border border-fg-subtle/10 bg-bg-base p-4 text-center text-xs text-fg-muted">
                No eval suites for this agent
              </div>
            ) : (
              <div className="max-h-60 space-y-1 overflow-y-auto rounded-lg border border-fg-subtle/10 bg-bg-base p-1.5">
                {suites.map((suite) => (
                  <button
                    key={suite.id}
                    type="button"
                    onClick={() => selectSuite(suite.id)}
                    className="flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left text-xs text-fg-secondary transition-colors hover:bg-bg-subtle/50"
                  >
                    <span className="flex-1 truncate font-medium">{suite.name}</span>
                    {suite.sopName ? (
                      <span className="shrink-0 text-fg-muted">{suite.sopName}</span>
                    ) : null}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div>
            <button
              type="button"
              onClick={() => setStep('suite')}
              className="mb-2 flex items-center gap-1 text-xs text-fg-muted hover:text-fg-primary transition-colors"
            >
              <ArrowLeft className="h-3 w-3" />
              Back to suites
            </button>
            <p className="mb-2 text-xs font-medium text-fg-muted">Select Test Case</p>
            {suiteDetailLoading ? (
              <div className="rounded-lg border border-fg-subtle/10 bg-bg-base p-4 text-center text-xs text-fg-muted">
                Loading test cases...
              </div>
            ) : testCases.length === 0 ? (
              <div className="rounded-lg border border-fg-subtle/10 bg-bg-base p-4 text-center text-xs text-fg-muted">
                No test cases in this suite
              </div>
            ) : (
              <div className="max-h-60 space-y-1 overflow-y-auto rounded-lg border border-fg-subtle/10 bg-bg-base p-1.5">
                {testCases.map((tc) => (
                  <button
                    key={tc.id}
                    type="button"
                    onClick={() => setSelectedCaseId(tc.id)}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left text-xs transition-colors',
                      selectedCaseId === tc.id
                        ? 'bg-brand-500/10 text-brand-400'
                        : 'text-fg-secondary hover:bg-bg-subtle/50',
                    )}
                  >
                    <span className="shrink-0 font-mono text-fg-muted">#{tc.order}</span>
                    <span className="flex-1 truncate">{tc.name}</span>
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
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {runMutation.error ? (
          <p className="text-xs text-error">Failed to run test case. Please try again.</p>
        ) : null}
      </div>

      <DialogFooter>
        <Button variant="secondary" onClick={handleClose}>
          Cancel
        </Button>
        <Button
          onClick={() => runMutation.mutate()}
          disabled={!selectedCaseId || step !== 'case'}
          loading={runMutation.isPending}
        >
          Run
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
