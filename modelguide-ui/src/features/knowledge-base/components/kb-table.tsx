import { useNavigate } from '@tanstack/react-router'
import { Badge } from '~/components/ui/badge'
import { formatDate } from '~/lib/utils'
import type { KnowledgeBaseSummary } from '~/schemas/knowledge-base'
import { CATEGORY_LABELS, priorityVariantMap } from '~/schemas/knowledge-base'

interface KbTableProps {
  items: KnowledgeBaseSummary[]
}

export function KbTable({ items }: KbTableProps) {
  const navigate = useNavigate()

  return (
    <div className="overflow-x-auto rounded-xl border border-fg-subtle/15 bg-bg-elevated">
      <table className="w-full">
        <thead className="bg-bg-elevated">
          <tr className="border-b border-fg-subtle/10">
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-fg-muted">
              Name
            </th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-fg-muted">
              Priority
            </th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-fg-muted">
              Category
            </th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-fg-muted">
              Status
            </th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-fg-muted">
              Agents
            </th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-fg-muted">
              Updated
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, index) => (
            <tr
              key={item.id}
              className="cursor-pointer border-b border-fg-subtle/5 transition-colors hover:bg-bg-subtle/50 animate-fade-up"
              style={{ animationDelay: `${index * 30}ms` }}
              onClick={() => navigate({ to: '/knowledge-base/$id', params: { id: item.id } })}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  navigate({ to: '/knowledge-base/$id', params: { id: item.id } })
                }
              }}
              tabIndex={0}
            >
              <td className="px-4 py-3">
                <div className="flex flex-col">
                  <span className="text-sm font-medium text-fg-primary">{item.name}</span>
                  <span className="line-clamp-1 text-xs text-fg-muted">{item.content}</span>
                </div>
              </td>
              <td className="px-4 py-3">
                <Badge variant={priorityVariantMap[item.config.priority]} dot>
                  {item.config.priority}
                </Badge>
              </td>
              <td className="px-4 py-3">
                <span className="text-sm text-fg-secondary">
                  {item.config.category ? CATEGORY_LABELS[item.config.category] : '-'}
                </span>
              </td>
              <td className="px-4 py-3">
                <Badge variant={item.isActive ? 'success' : 'default'} dot>
                  {item.isActive ? 'Active' : 'Inactive'}
                </Badge>
              </td>
              <td className="px-4 py-3">
                {item.assignedAgents.length > 0 ? (
                  <div className="flex items-center gap-1">
                    {item.assignedAgents.slice(0, 3).map((agent) => (
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
                    {item.assignedAgents.length > 3 ? (
                      <span className="text-xs text-fg-muted">
                        +{item.assignedAgents.length - 3}
                      </span>
                    ) : null}
                  </div>
                ) : (
                  <span className="text-xs text-fg-muted">None</span>
                )}
              </td>
              <td className="px-4 py-3">
                <span className="text-xs text-fg-muted">
                  {formatDate(item.updatedAt ?? item.createdAt, { format: 'relative' })}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
