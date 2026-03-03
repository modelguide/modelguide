import { useNavigate } from '@tanstack/react-router'
import { GitFork } from 'lucide-react'
import { Badge } from '~/components/ui/badge'
import { formatDate } from '~/lib/utils'
import type { SopSummary } from '~/schemas/sops'
import { statusVariantMap } from '~/schemas/sops'

interface SopsTableProps {
  sops: SopSummary[]
}

export function SopsTable({ sops }: SopsTableProps) {
  const navigate = useNavigate()

  return (
    <div className="overflow-x-auto rounded-xl border border-fg-subtle/15 bg-bg-elevated">
      <table className="w-full">
        <thead>
          <tr className="border-b border-fg-subtle/10">
            <th className="px-4 py-3 text-left text-xs font-medium text-fg-muted">Name</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-fg-muted">Status</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-fg-muted">Steps</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-fg-muted">Agents</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-fg-muted">Template</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-fg-muted">Updated</th>
          </tr>
        </thead>
        <tbody>
          {sops.map((sop, index) => (
            <tr
              key={sop.id}
              className="cursor-pointer border-b border-fg-subtle/5 transition-colors hover:bg-bg-subtle/50 animate-fade-up"
              style={{ animationDelay: `${index * 30}ms` }}
              onClick={() => navigate({ to: '/sops/$id', params: { id: sop.id } })}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  navigate({ to: '/sops/$id', params: { id: sop.id } })
                }
              }}
              tabIndex={0}
            >
              <td className="px-4 py-3">
                <div className="flex flex-col">
                  <span className="text-sm font-medium text-fg-primary">{sop.name}</span>
                  <span className="font-mono text-xs text-fg-muted">{sop.slug}</span>
                </div>
              </td>
              <td className="px-4 py-3">
                <Badge variant={statusVariantMap[sop.status]} dot>
                  {sop.status}
                </Badge>
              </td>
              <td className="px-4 py-3">
                <span className="text-sm text-fg-secondary">{sop.stepCount}</span>
              </td>
              <td className="px-4 py-3">
                {sop.assignedAgents.length > 0 ? (
                  <div className="flex items-center gap-1">
                    {sop.assignedAgents.slice(0, 3).map((agent) => (
                      <span
                        key={agent.id}
                        className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-bg-subtle text-[10px] font-medium text-fg-secondary ring-1 ring-fg-subtle/15"
                        title={agent.name}
                      >
                        {agent.name
                          .split(' ')
                          .map((w) => w[0])
                          .join('')
                          .toUpperCase()
                          .slice(0, 2)}
                      </span>
                    ))}
                    {sop.assignedAgents.length > 3 ? (
                      <span className="text-xs text-fg-muted">
                        +{sop.assignedAgents.length - 3}
                      </span>
                    ) : null}
                  </div>
                ) : (
                  <span className="text-xs text-fg-muted">None</span>
                )}
              </td>
              <td className="px-4 py-3">
                {sop.templateName ? (
                  <span className="inline-flex items-center gap-1 text-xs text-fg-secondary">
                    <GitFork className="h-3 w-3" />
                    {sop.templateName}
                  </span>
                ) : (
                  <span className="text-xs text-fg-muted">Custom</span>
                )}
              </td>
              <td className="px-4 py-3">
                <span className="text-xs text-fg-muted">
                  {formatDate(sop.updatedAt ?? sop.createdAt, { format: 'relative' })}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
