import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Bot, ExternalLink, Users } from 'lucide-react'
import { useState } from 'react'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'
import { Dialog, DialogFooter } from '~/components/ui/dialog'
import { api } from '~/lib/api'
import type { PaginatedResponse } from '~/lib/pagination'
import type { AssignedAgent, KnowledgeBaseDetail } from '~/schemas/knowledge-base'

interface Agent {
  id: string
  name: string
  modality: string
}

interface KbAgentsCardProps {
  kbId: string
  agents: AssignedAgent[]
  canMutate: boolean
}

export function KbAgentsCard({ kbId, agents, canMutate }: KbAgentsCardProps) {
  const [showDialog, setShowDialog] = useState(false)

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Users className="h-4 w-4" />
            Assigned Agents ({agents.length})
          </CardTitle>
          {canMutate ? (
            <Button variant="secondary" size="sm" onClick={() => setShowDialog(true)}>
              Manage
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent>
        {agents.length === 0 ? (
          <p className="font-sans text-sm text-fg-muted">No agents assigned to this guardrail</p>
        ) : (
          <ul className="space-y-2">
            {agents.map((agent) => (
              <li key={agent.id}>
                <Link
                  to="/agents/$id"
                  params={{ id: agent.id }}
                  className="flex items-center gap-3 rounded-lg border border-fg-subtle/10 bg-bg-base p-2.5 transition-colors hover:bg-bg-subtle/50 group"
                >
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-bg-subtle">
                    <Bot className="h-4 w-4 text-fg-muted" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-fg-primary group-hover:text-brand-400 transition-colors truncate">
                      {agent.name}
                    </p>
                  </div>
                  <ExternalLink className="h-3.5 w-3.5 text-fg-muted opacity-0 group-hover:opacity-100 transition-opacity" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      {showDialog ? (
        <AgentPickerDialog
          kbId={kbId}
          currentAgentIds={agents.map((a) => a.id)}
          onClose={() => setShowDialog(false)}
        />
      ) : null}
    </Card>
  )
}

function AgentPickerDialog({
  kbId,
  currentAgentIds,
  onClose,
}: {
  kbId: string
  currentAgentIds: string[]
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [selected, setSelected] = useState<Set<string>>(new Set(currentAgentIds))

  const { data: agentsData, isLoading } = useQuery({
    queryKey: ['agents'],
    queryFn: () => api.get('agents?pageSize=100').json<PaginatedResponse<Agent>>(),
  })

  const mutation = useMutation({
    mutationFn: (agentIds: string[]) =>
      api.patch(`knowledge-base/${kbId}`, { json: { agentIds } }).json<KnowledgeBaseDetail>(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['knowledge-base', kbId] })
      onClose()
    },
  })

  const agents = agentsData?.data ?? []

  const toggleAgent = (agentId: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(agentId)) next.delete(agentId)
      else next.add(agentId)
      return next
    })
  }

  return (
    <Dialog open onClose={onClose} title="Manage Agent Assignments" size="sm">
      <div className="space-y-2 max-h-64 overflow-y-auto">
        {isLoading ? (
          <p className="text-sm text-fg-muted py-4 text-center">Loading agents...</p>
        ) : agents.length === 0 ? (
          <p className="text-sm text-fg-muted py-4 text-center">No agents available</p>
        ) : (
          agents.map((agent) => (
            <label
              key={agent.id}
              className="flex cursor-pointer items-center gap-3 rounded-lg border border-fg-subtle/10 p-3 transition-colors hover:bg-bg-subtle/50"
            >
              <input
                type="checkbox"
                checked={selected.has(agent.id)}
                onChange={() => toggleAgent(agent.id)}
                className="h-4 w-4 rounded border-fg-subtle/30 bg-bg-subtle text-brand-500 focus:ring-brand-500"
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-fg-primary">{agent.name}</p>
              </div>
              <Badge variant="default">{agent.modality}</Badge>
            </label>
          ))
        )}
      </div>
      {mutation.isError ? (
        <p className="text-sm text-error px-1">
          {mutation.error instanceof Error ? mutation.error.message : 'Failed to update agents'}
        </p>
      ) : null}
      <DialogFooter>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={() => mutation.mutate([...selected])} loading={mutation.isPending}>
          Save
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
