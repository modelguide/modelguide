import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Sparkles } from 'lucide-react'
import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '~/components/ui/button'
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
    rejectionsBySource: { structural: number; semantic: number }
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
}

export function GenerateTestCasesButton({ suiteId, hasSop }: GenerateTestCasesButtonProps) {
  const queryClient = useQueryClient()
  const [taskId, setTaskId] = useState<string | null>(null)

  const isPolling = taskId !== null

  // Poll task status
  const { data: taskStatus } = useQuery({
    queryKey: ['generation-tasks', taskId],
    queryFn: () => api.get(`eval-suites/generation-tasks/${taskId}`).json<TaskStatus>(),
    enabled: isPolling,
    refetchInterval: (query) => {
      const status = query.state.data?.status
      if (status === 'completed' || status === 'failed') return false
      return 2000
    },
  })

  // Handle completion/failure
  const handleTaskComplete = useCallback(
    (status: TaskStatus) => {
      setTaskId(null)
      queryClient.invalidateQueries({ queryKey: ['eval-suites', suiteId] })

      if (status.status === 'completed' && status.progress?.result) {
        const r = status.progress.result
        toast.success(`Generated ${r.accepted} test cases (${r.rejected} rejected)`)
      } else if (status.status === 'failed') {
        toast.error(status.error ?? status.progress?.error ?? 'Test case generation failed')
      }
    },
    [queryClient, suiteId],
  )

  // Detect completion
  if (
    taskStatus &&
    (taskStatus.status === 'completed' || taskStatus.status === 'failed') &&
    taskId
  ) {
    handleTaskComplete(taskStatus)
  }

  // Start generation
  const generateMutation = useMutation({
    mutationFn: () =>
      api
        .post(`eval-suites/${suiteId}/generate-test-cases`, { json: { count: 40 } })
        .json<GenerateTestCasesResponse>(),
    onSuccess: (data) => {
      setTaskId(data.taskId)
    },
    onError: () => {
      toast.error('Failed to start test case generation')
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
    <Button
      variant="secondary"
      onClick={() => generateMutation.mutate()}
      loading={generateMutation.isPending || isPolling}
      disabled={!hasSop}
      title={
        hasSop ? 'Generate synthetic test cases from SOP' : 'Link a SOP to generate test cases'
      }
    >
      <Sparkles className="h-4 w-4" />
      Generate Cases
    </Button>
  )
}
