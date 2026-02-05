import { useQuery } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { Spinner } from '~/components/ui/spinner'
import { SessionDetail } from '~/features/sessions/components/session-detail'
import { api } from '~/lib/api'
import type { Session } from '~/schemas/sessions'

export const Route = createFileRoute('/_authenticated/sessions/$id')({
  component: SessionDetailPage,
})

function SessionDetailPage() {
  const { id } = Route.useParams()

  const {
    data: session,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['sessions', id],
    queryFn: () => api.get(`sessions/${id}`).json<Session>(),
  })

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
          <h1 className="text-2xl font-bold text-fg-primary">Session Detail</h1>
          <p className="mt-1 font-mono text-xs text-fg-muted">{id}</p>
        </div>
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
        <SessionDetail session={session} />
      ) : null}
    </div>
  )
}
