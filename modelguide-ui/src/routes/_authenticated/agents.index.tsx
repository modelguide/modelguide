import { useQuery } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import { Bot, Plus } from 'lucide-react'
import { Button } from '~/components/ui/button'
import { PageHeader } from '~/components/ui/page-header'
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
      <PageHeader
        icon={Bot}
        iconBg="bg-teal/15"
        iconColor="text-teal"
        title="Agents"
        description="Manage your AI agents and their configurations"
        actions={
          isAdmin ? (
            <Link to="/agents/new">
              <Button>
                <Plus className="h-4 w-4" />
                Create Agent
              </Button>
            </Link>
          ) : null
        }
      />

      <AgentsTable agents={data?.items ?? []} isLoading={isLoading} isAdmin={isAdmin} />
    </div>
  )
}
