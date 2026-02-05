import { useQuery } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import { Bot, Plus } from 'lucide-react'
import { Button } from '~/components/ui/button'
import { AgentsTable } from '~/features/agents/components/agents-table'
import { api } from '~/lib/api'
import type { AgentListResponse } from '~/schemas/agents'
import { useAuthStore } from '~/stores/auth'

export const Route = createFileRoute('/_authenticated/agents/')({
  component: AgentsPage,
})

function AgentsPage() {
  const user = useAuthStore((s) => s.user)
  const isAdmin = user?.role === 'admin'

  const { data, isLoading } = useQuery({
    queryKey: ['agents'],
    queryFn: () => api.get('agents').json<AgentListResponse>(),
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between animate-fade-up">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal/15">
            <Bot className="h-5 w-5 text-teal" />
          </div>
          <div>
            <h1 className="font-display text-3xl font-bold tracking-tight text-fg-primary">
              Agents
            </h1>
            <p className="text-sm text-fg-muted">Manage your AI agents and their configurations</p>
          </div>
        </div>
        {isAdmin ? (
          <Link to="/agents/new">
            <Button>
              <Plus className="h-4 w-4" />
              Create Agent
            </Button>
          </Link>
        ) : null}
      </div>

      <AgentsTable agents={data?.items ?? []} isLoading={isLoading} isAdmin={isAdmin} />
    </div>
  )
}
