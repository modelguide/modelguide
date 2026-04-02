import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Sparkles } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '~/components/ui/button'
import { Dialog, DialogFooter } from '~/components/ui/dialog'
import { api } from '~/lib/api'
import { GenerationProgressBar } from './generation-progress-bar'

interface GenerateTestCasesResponse {
  taskId: string
  status: 'running'
}

interface GenerationProgress {
  status: 'deriving_dimensions' | 'generating' | 'completed' | 'failed'
  completed: number
  total: number
  accepted: number
  rejected: number
  error?: string
  result?: {
    accepted: number
    rejected: number
    rejectionsBySource: { structural: number; semantic: number; error: number }
    topIssues?: { issue: string; count: number }[]
  }
}

interface TaskStatus {
  id: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  progress?: GenerationProgress
  error?: string
}

export interface GenerateTestCasesButtonProps {
  suiteId: string
  hasSop: boolean
  onProgress?: (remaining: number) => void
}

export function GenerateTestCasesButton({
  suiteId,
  hasSop,
  onProgress,
}: GenerateTestCasesButtonProps) {
  const queryClient = useQueryClient()
  const [taskId, setTaskId] = useState<string | null>(null)
  const [showConfirm, setShowConfirm] = useState(false)

  const isPolling = taskId !== null

  // Poll task status + live-refresh test cases list
  const { data: taskStatus, error: pollingError } = useQuery({
    queryKey: ['generation-tasks', taskId],
    queryFn: async () => {
      const result = await api.get(`eval-suites/generation-tasks/${taskId}`).json<TaskStatus>()
      // Refresh test cases list as new cases are accepted
      if (result.progress?.accepted && result.progress.accepted > 0) {
        queryClient.invalidateQueries({ queryKey: ['eval-suites', suiteId] })
      }
      return result
    },
    enabled: isPolling,
    retry: 3,
    refetchInterval: (query) => {
      const status = query.state.data?.status
      if (status === 'completed' || status === 'failed') return false
      return 2000
    },
  })

  // Handle polling failure (network error after retries exhausted)
  useEffect(() => {
    if (pollingError && isPolling) {
      setTaskId(null)
      onProgress?.(0)
      queryClient.invalidateQueries({ queryKey: ['eval-suites', suiteId] })
      toast.error('Lost connection to generation task — refresh to check status')
    }
  }, [pollingError, isPolling, queryClient, suiteId, onProgress])

  // Handle completion/failure
  const handleTaskComplete = useCallback(
    (status: TaskStatus) => {
      setTaskId(null)
      queryClient.invalidateQueries({ queryKey: ['eval-suites', suiteId] })

      if (status.status === 'completed' && status.progress?.result) {
        const r = status.progress.result
        if (r.rejected === 0) {
          toast.success(`Generated ${r.accepted} test cases`)
        } else {
          const parts = []
          if (r.rejectionsBySource.structural > 0)
            parts.push(`${r.rejectionsBySource.structural} structural`)
          if (r.rejectionsBySource.semantic > 0)
            parts.push(`${r.rejectionsBySource.semantic} semantic`)
          if (r.rejectionsBySource.error > 0) parts.push(`${r.rejectionsBySource.error} errors`)
          const breakdown = parts.length > 0 ? ` (${parts.join(', ')})` : ''
          const topIssue = r.topIssues?.[0]?.issue
          const issueHint = topIssue ? `\nTop issue: ${topIssue}` : ''
          toast.warning(
            `Generated ${r.accepted} test cases, ${r.rejected} rejected${breakdown}${issueHint}`,
            {
              duration: 8000,
            },
          )
        }
      } else if (status.status === 'failed') {
        toast.error(status.error ?? status.progress?.error ?? 'Test case generation failed')
      }
    },
    [queryClient, suiteId],
  )

  // Detect completion (in useEffect to avoid state updates during render)
  useEffect(() => {
    if (
      taskStatus &&
      (taskStatus.status === 'completed' || taskStatus.status === 'failed') &&
      taskId
    ) {
      handleTaskComplete(taskStatus)
    }
  }, [taskStatus, taskId, handleTaskComplete])

  // Report remaining count to parent
  useEffect(() => {
    if (!onProgress) return
    if (!isPolling || !taskStatus?.progress) {
      onProgress(0)
      return
    }
    const { total, completed, status } = taskStatus.progress
    if (status === 'completed' || status === 'failed') {
      onProgress(0)
    } else if (status === 'deriving_dimensions') {
      // Don't know total yet, signal activity with a placeholder count
      onProgress(3)
    } else {
      onProgress(Math.max(total - completed, 0))
    }
  }, [isPolling, taskStatus, onProgress])

  // Start generation
  const generateMutation = useMutation({
    mutationFn: () =>
      api
        .post(`eval-suites/${suiteId}/generate-test-cases`, { json: { count: 40 } })
        .json<GenerateTestCasesResponse>(),
    onSuccess: (data) => {
      setTaskId(data.taskId)
    },
    onError: async (error: unknown) => {
      let message = 'Failed to start test case generation'
      if (error && typeof error === 'object' && 'response' in error) {
        try {
          const body = await (error as { response: Response }).response.json()
          if (body?.message) message = body.message
        } catch {
          const response = (error as { response: Response }).response
          message = `Failed to start generation (HTTP ${response.status})`
        }
      }
      toast.error(message)
    },
  })

  const progress = taskStatus?.progress

  if (isPolling && progress) {
    return (
      <div className="w-64">
        <GenerationProgressBar
          completed={progress.completed}
          total={progress.total}
          accepted={progress.accepted}
          rejected={progress.rejected}
          status={progress.status}
        />
      </div>
    )
  }

  return (
    <>
      <Button
        variant="secondary"
        onClick={() => setShowConfirm(true)}
        loading={generateMutation.isPending || isPolling}
        disabled={!hasSop}
        title={
          hasSop ? 'Generate synthetic test cases from SOP' : 'Link a SOP to generate test cases'
        }
      >
        <Sparkles className="h-4 w-4" />
        Generate Cases
      </Button>

      <Dialog
        open={showConfirm}
        onClose={() => setShowConfirm(false)}
        title="Generate Test Cases"
        description="This will replace all existing auto-generated test cases with a new set derived from the linked SOP. Manually created test cases will be preserved."
      >
        <DialogFooter>
          <Button variant="secondary" onClick={() => setShowConfirm(false)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              setShowConfirm(false)
              generateMutation.mutate()
            }}
          >
            Generate
          </Button>
        </DialogFooter>
      </Dialog>
    </>
  )
}
