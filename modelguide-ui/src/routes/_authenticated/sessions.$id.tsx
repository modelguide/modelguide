import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import { ArrowLeft, FlaskConical, Pin } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { RatingDialog } from '~/components/ui/rating-dialog'
import { Spinner } from '~/components/ui/spinner'
import { PinToSuiteDialog } from '~/features/evals/components/pin-to-suite-dialog'
import { RunAgainstTestCaseDialog } from '~/features/evals/components/run-against-test-case-dialog'
import { SessionDetail } from '~/features/sessions/components/session-detail'
import { api } from '~/lib/api'
import { useCanMutate } from '~/lib/permissions'
import type { SessionDetail as SessionDetailType, SessionStatus } from '~/schemas/sessions'

const statusVariants: Record<SessionStatus, 'active' | 'completed' | 'abandoned'> = {
  active: 'active',
  completed: 'completed',
  abandoned: 'abandoned',
}

function isTerminal(status: SessionStatus): boolean {
  return status === 'completed' || status === 'abandoned'
}

export const Route = createFileRoute('/_authenticated/sessions/$id')({
  component: SessionDetailPage,
})

function SessionDetailPage() {
  const { id } = Route.useParams()
  const canMutate = useCanMutate()
  const queryClient = useQueryClient()
  const [ratingOpen, setRatingOpen] = useState(false)
  const [pinDialogOpen, setPinDialogOpen] = useState(false)
  const [runDialogOpen, setRunDialogOpen] = useState(false)

  const classifyMutation = useMutation({
    mutationFn: () => api.post(`sessions/${id}/classify`).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions', id] })
      toast.success('Session classified')
    },
    onError: () => {
      toast.error('Classification failed')
    },
  })

  const {
    data: session,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['sessions', id],
    queryFn: () => api.get(`sessions/${id}`).json<SessionDetailType>(),
    refetchInterval: (query) => (query.state.data?.status === 'active' ? 5_000 : false),
  })

  const supportFeedback = [...(session?.feedback ?? [])]
    .reverse()
    .find((f) => f.feedbackSource === 'support')

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4 animate-fade-up">
        <Link
          to="/sessions"
          className="flex h-8 w-8 items-center justify-center rounded text-fg-secondary hover:bg-bg-subtle hover:text-fg-primary"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-fg-primary">Session Detail</h1>
            {session && <Badge variant={statusVariants[session.status]}>{session.status}</Badge>}
          </div>
          <p className="mt-0.5 font-mono text-xs text-fg-muted">{id}</p>
        </div>

        {/* Eval actions for terminal sessions (AC 23, 26) */}
        {session && isTerminal(session.status) && canMutate ? (
          <div className="ml-auto flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => setPinDialogOpen(true)}>
              <Pin className="mr-1.5 h-3.5 w-3.5" />
              Pin to Suite
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setRunDialogOpen(true)}>
              <FlaskConical className="mr-1.5 h-3.5 w-3.5" />
              Run Against Test Case
            </Button>
          </div>
        ) : null}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Spinner size="lg" />
        </div>
      ) : error ? (
        <div className="rounded-lg border border-error/30 bg-error-muted p-6 text-center">
          <p className="text-sm text-error">Failed to load session</p>
        </div>
      ) : session ? (
        <>
          <SessionDetail
            session={session}
            onRate={canMutate ? () => setRatingOpen(true) : undefined}
            onClassify={
              canMutate && !session.sopClassification ? () => classifyMutation.mutate() : undefined
            }
            isClassifying={classifyMutation.isPending}
          />
          <RatingDialog
            sessionId={id}
            open={ratingOpen}
            onClose={() => setRatingOpen(false)}
            existingFeedback={
              supportFeedback
                ? {
                    id: supportFeedback.id,
                    rating: supportFeedback.rating,
                    comment: supportFeedback.comment,
                  }
                : undefined
            }
          />
          {session.agent.id ? (
            <>
              <PinToSuiteDialog
                open={pinDialogOpen}
                onClose={() => setPinDialogOpen(false)}
                sessionId={id}
                agentId={session.agent.id}
              />
              <RunAgainstTestCaseDialog
                open={runDialogOpen}
                onClose={() => setRunDialogOpen(false)}
                sessionId={id}
                agentId={session.agent.id}
              />
            </>
          ) : null}
        </>
      ) : null}
    </div>
  )
}
