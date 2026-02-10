import { Link, useNavigate } from '@tanstack/react-router'
import { Edit, Trash } from 'lucide-react'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { formatDate } from '~/lib/utils'
import type { Agent } from '~/schemas/agents'

export interface AgentsTableProps {
  agents: Agent[]
  isLoading?: boolean
  isAdmin?: boolean
  onDelete?: (agent: Agent) => void
}

export function AgentsTable({ agents, isLoading, isAdmin, onDelete }: AgentsTableProps) {
  const navigate = useNavigate()

  if (isLoading) {
    return (
      <div className="space-y-2">
        {['skel-1', 'skel-2', 'skel-3'].map((key) => (
          <div key={key} className="h-16 animate-pulse rounded bg-bg-subtle" />
        ))}
      </div>
    )
  }

  if (agents.length === 0) {
    return (
      <div className="rounded-lg border border-fg-subtle/20 bg-bg-elevated p-8 text-center">
        <p className="text-sm text-fg-muted">No agents found</p>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-fg-subtle/20">
      <table className="w-full">
        <thead className="bg-bg-elevated">
          <tr className="border-b border-fg-subtle/10">
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-fg-muted">
              Name
            </th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-fg-muted">
              Platform
            </th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-fg-muted">
              Status
            </th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-fg-muted">
              Created
            </th>
            {isAdmin ? (
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-fg-muted">
                Actions
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {agents.map((agent) => (
            // biome-ignore lint/a11y/useKeyWithClickEvents: Keyboard nav in backlog
            <tr
              key={agent.id}
              onClick={() => navigate({ to: '/agents/$id', params: { id: agent.id } })}
              className="cursor-pointer border-b border-fg-subtle/5 transition-colors hover:bg-bg-subtle/50"
            >
              <td className="px-4 py-3">
                <span className="text-sm font-medium text-fg-primary group-hover:text-brand-500">
                  {agent.name}
                </span>
                {agent.description ? (
                  <p className="mt-0.5 font-sans text-xs text-fg-muted line-clamp-1">
                    {agent.description}
                  </p>
                ) : null}
              </td>
              <td className="px-4 py-3">
                <Badge variant={agent.agentPlatform === 'elevenlabs' ? 'brand' : 'default'}>
                  {agent.agentPlatform}
                </Badge>
              </td>
              <td className="px-4 py-3">
                <Badge variant={agent.isActive ? 'success' : 'default'} dot>
                  {agent.isActive ? 'active' : 'inactive'}
                </Badge>
              </td>
              <td className="px-4 py-3">
                <span className="text-sm text-fg-secondary">
                  {formatDate(agent.createdAt, { format: 'date' })}
                </span>
              </td>
              {isAdmin ? (
                // biome-ignore lint/a11y/useKeyWithClickEvents: stopPropagation for actions
                <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center gap-2">
                    <Link to="/agents/$id" params={{ id: agent.id }}>
                      <Button variant="ghost" size="icon-sm">
                        <Edit className="h-4 w-4" />
                      </Button>
                    </Link>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => onDelete?.(agent)}
                      className="text-error hover:text-error"
                    >
                      <Trash className="h-4 w-4" />
                    </Button>
                  </div>
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
