import { useNavigate } from '@tanstack/react-router'
import { MessageSquare } from 'lucide-react'
import { Badge } from '~/components/ui/badge'
import { RatingBadge } from '~/components/ui/rating-badge'
import { Tooltip } from '~/components/ui/tooltip'
import { channelConfig } from '~/lib/channel-config'
import { formatDate, formatDuration } from '~/lib/utils'
import type { SessionListItem, SessionStatus, SopClassification } from '~/schemas/sessions'

function formatCost(costUsd?: number | null, totalTokens?: number | null): string {
  if (costUsd != null) return `$${costUsd.toFixed(4)}`
  if (totalTokens != null) return `${totalTokens.toLocaleString()} tok`
  return '\u2014'
}

const statusVariants: Record<SessionStatus, 'active' | 'completed' | 'abandoned'> = {
  active: 'active',
  completed: 'completed',
  abandoned: 'abandoned',
}

export interface SessionsTableProps {
  sessions: SessionListItem[]
  isLoading?: boolean
  total?: number
}

export function SessionsTable({ sessions, isLoading, total }: SessionsTableProps) {
  if (isLoading) {
    return (
      <div className="overflow-hidden rounded-2xl border border-fg-subtle/10 bg-bg-elevated">
        <div className="space-y-0">
          {['skel-1', 'skel-2', 'skel-3', 'skel-4', 'skel-5'].map((key, i) => (
            <div
              key={key}
              className="h-16 border-b border-fg-subtle/5 last:border-0"
              style={{ animationDelay: `${i * 50}ms` }}
            >
              <div className="flex h-full items-center gap-4 px-5">
                <div className="h-3 w-16 animate-pulse rounded bg-bg-subtle" />
                <div className="h-3 w-24 animate-pulse rounded bg-bg-subtle" />
                <div className="h-3 w-16 animate-pulse rounded bg-bg-subtle" />
                <div className="flex-1" />
                <div className="h-6 w-20 animate-pulse rounded-full bg-bg-subtle" />
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (sessions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-fg-subtle/10 bg-bg-elevated py-20">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-bg-subtle">
          <MessageSquare className="h-8 w-8 text-fg-muted" />
        </div>
        <p className="font-display text-lg font-semibold text-fg-primary">No sessions yet</p>
        <p className="mt-1 text-sm text-fg-muted">
          Sessions will appear here once conversations start
        </p>
      </div>
    )
  }

  return (
    <>
      {total !== undefined && (
        <p className="mb-3 text-sm text-fg-muted">
          Showing <span className="font-medium text-fg-secondary">{sessions.length}</span> of{' '}
          <span className="font-medium text-fg-secondary">{total}</span> sessions
        </p>
      )}
      <div className="rounded-2xl border border-fg-subtle/10 bg-bg-elevated">
        <table className="w-full">
          <thead>
            <tr className="border-b border-fg-subtle/10 bg-bg-subtle/30">
              <th className="w-[12%] px-4 py-3 text-left font-display text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
                Time
              </th>
              <th className="w-[16%] px-4 py-3 text-left font-display text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
                Agent
              </th>
              <th className="w-[12%] px-4 py-3 text-left font-display text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
                Channel
              </th>
              <th className="w-[13%] px-4 py-3 text-left font-display text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
                User
              </th>
              <th className="w-[9%] px-4 py-3 text-left font-display text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
                Status
              </th>
              <th className="w-[12%] px-4 py-3 text-left font-display text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
                SOP
              </th>
              <th className="w-[9%] px-4 py-3 text-left font-display text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
                Duration
              </th>
              <th className="w-[8%] px-4 py-3 text-left font-display text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
                Msgs
              </th>
              <th className="w-[8%] px-4 py-3 text-left font-display text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
                Cost
              </th>
              <th className="w-[5%] px-4 py-3 text-left font-display text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
                User
              </th>
              <th className="w-[5%] px-4 py-3 text-left font-display text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
                Expert
              </th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((session, index) => (
              <SessionRow key={session.id} session={session} index={index} />
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

interface SessionRowProps {
  session: SessionListItem
  index: number
}

function SessionRow({ session, index }: SessionRowProps) {
  const navigate = useNavigate()

  const handleRowClick = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) {
      return
    }
    navigate({ to: '/sessions/$id', params: { id: session.id } })
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).closest('button')) {
      return
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      navigate({ to: '/sessions/$id', params: { id: session.id } })
    }
  }

  return (
    <tr
      onClick={handleRowClick}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      aria-label={`View session with ${session.agent.name}, ${session.status}`}
      className="table-row-interactive cursor-pointer border-b border-fg-subtle/5 last:border-0 animate-fade-up focus:outline-none focus:bg-brand-500/5"
      style={{ animationDelay: `${index * 30}ms` }}
    >
      <td className="px-4 py-3">
        <Tooltip
          content={
            <div className="text-center">
              <div className="font-medium">{formatDate(session.startedAt, { format: 'date' })}</div>
              <div className="text-fg-muted">
                {formatDate(session.startedAt, { format: 'time' })}
              </div>
            </div>
          }
          side="top"
        >
          <span className="cursor-default text-sm text-fg-secondary">
            {formatDate(session.startedAt, { format: 'relative' })}
          </span>
        </Tooltip>
      </td>
      <td className="px-4 py-3">
        <span className="text-sm font-medium text-fg-primary">{session.agent.name}</span>
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2 text-fg-secondary">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-bg-subtle">
            {channelConfig[session.channelType].icon}
          </span>
          <span className="text-sm">{channelConfig[session.channelType].label}</span>
        </div>
      </td>
      <td className="px-4 py-3">
        <span className="text-sm text-fg-secondary">{session.userIdentifier}</span>
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-1.5">
          <Badge variant={statusVariants[session.status]}>{session.status}</Badge>
          {session.mode === 'simulation' && (
            <Badge variant="warning" dot>
              Sim
            </Badge>
          )}
        </div>
      </td>
      <td className="px-4 py-3">
        <SopBadge classification={session.sopClassification} />
      </td>
      <td className="px-4 py-3">
        <span className="font-mono text-sm text-fg-secondary">
          {session.durationSeconds ? formatDuration(session.durationSeconds) : '\u2014'}
        </span>
      </td>
      <td className="px-4 py-3">
        <span className="font-mono text-sm text-fg-secondary">{session.messageCount}</span>
      </td>
      <td className="px-4 py-3">
        <span className="font-mono text-sm text-fg-secondary">
          {formatCost(session.costUsd, session.totalTokens)}
        </span>
      </td>
      <td className="px-4 py-3">
        <RatingBadge rating={session.feedbackSummary.customerRating ?? undefined} size="xs" />
      </td>
      <td className="px-4 py-3">
        <RatingBadge rating={session.feedbackSummary.supportRating ?? undefined} size="xs" />
      </td>
    </tr>
  )
}

function SopBadge({ classification }: { classification: SopClassification }) {
  if (!classification) {
    return <span className="text-xs text-fg-muted">{'\u2014'}</span>
  }

  if (classification.unknown || !classification.sopSlug) {
    return (
      <Badge variant="warning" dot>
        Unknown
      </Badge>
    )
  }

  return (
    <Tooltip
      content={`Slug: ${classification.sopSlug}${classification.confidence != null ? ` | Confidence: ${Math.round(classification.confidence * 100)}%` : ''}`}
    >
      <Badge variant="brand" dot>
        {classification.sopName ?? classification.sopSlug}
      </Badge>
    </Tooltip>
  )
}
