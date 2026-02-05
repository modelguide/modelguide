import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import {
  Globe,
  MessageCircle,
  MessageSquare,
  Phone,
  Send,
  Slack,
  ThumbsDown,
  ThumbsUp,
} from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Dialog } from '~/components/ui/dialog'
import { Tooltip } from '~/components/ui/tooltip'
import { api } from '~/lib/api'
import { cn } from '~/lib/cn'
import { formatDate, formatDuration } from '~/lib/utils'
import type { ChannelType, Session, SessionStatus } from '~/schemas/sessions'

const channelConfig: Record<ChannelType, { icon: ReactNode; label: string }> = {
  voice: { icon: <Phone className="h-4 w-4" />, label: 'Voice' },
  web: { icon: <Globe className="h-4 w-4" />, label: 'Web' },
  api: { icon: <Send className="h-4 w-4" />, label: 'API' },
  slack: { icon: <Slack className="h-4 w-4" />, label: 'Slack' },
  widget: { icon: <MessageCircle className="h-4 w-4" />, label: 'Widget' },
  sms: { icon: <MessageCircle className="h-4 w-4" />, label: 'SMS' },
  whatsapp: { icon: <MessageCircle className="h-4 w-4" />, label: 'WhatsApp' },
}

const statusVariants: Record<SessionStatus, 'active' | 'completed' | 'escalated' | 'abandoned'> = {
  active: 'active',
  completed: 'completed',
  escalated: 'escalated',
  abandoned: 'abandoned',
}

export interface SessionsTableProps {
  sessions: Session[]
  isLoading?: boolean
  total?: number
}

export function SessionsTable({ sessions, isLoading, total }: SessionsTableProps) {
  const [ratingSession, setRatingSession] = useState<Session | null>(null)

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
              <th className="w-[10%] px-4 py-3 text-left font-display text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
                Time
              </th>
              <th className="w-[15%] px-4 py-3 text-left font-display text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
                Agent
              </th>
              <th className="w-[12%] px-4 py-3 text-left font-display text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
                Channel
              </th>
              <th className="w-[13%] px-4 py-3 text-left font-display text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
                User
              </th>
              <th className="w-[10%] px-4 py-3 text-left font-display text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
                Status
              </th>
              <th className="w-[10%] px-4 py-3 text-left font-display text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
                Duration
              </th>
              <th className="w-[15%] px-4 py-3 text-left font-display text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
                User Rating
              </th>
              <th className="w-[15%] px-4 py-3 text-left font-display text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
                Expert Rating
              </th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((session, index) => (
              <SessionRow
                key={session.id}
                session={session}
                onRate={() => setRatingSession(session)}
                index={index}
              />
            ))}
          </tbody>
        </table>
      </div>

      {ratingSession && (
        <RatingDialog
          session={ratingSession}
          open={!!ratingSession}
          onClose={() => setRatingSession(null)}
        />
      )}
    </>
  )
}

interface SessionRowProps {
  session: Session
  onRate: () => void
  index: number
}

function SessionRow({ session, onRate, index }: SessionRowProps) {
  const navigate = useNavigate()
  const supportFeedback = session.feedback?.find((f) => f.feedback_source === 'support')
  const customerFeedback = session.feedback?.find((f) => f.feedback_source === 'customer')

  const handleRowClick = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) {
      return
    }
    navigate({ to: '/sessions/$id', params: { id: session.id } })
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
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
      className="table-row-interactive cursor-pointer border-b border-fg-subtle/5 last:border-0 animate-fade-up focus:outline-none focus:bg-brand-500/5"
      style={{ animationDelay: `${index * 30}ms` }}
    >
      <td className="px-4 py-3">
        <Tooltip
          content={
            <div className="text-center">
              <div className="font-medium">
                {formatDate(session.started_at, { format: 'date' })}
              </div>
              <div className="text-fg-muted">
                {formatDate(session.started_at, { format: 'time' })}
              </div>
            </div>
          }
          side="top"
        >
          <span className="cursor-default text-sm text-fg-secondary">
            {formatDate(session.started_at, { format: 'relative' })}
          </span>
        </Tooltip>
      </td>
      <td className="px-4 py-3">
        <span className="text-sm font-medium text-fg-primary">{session.agent.name}</span>
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2 text-fg-secondary">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-bg-subtle">
            {channelConfig[session.channel_type].icon}
          </span>
          <span className="text-sm">{channelConfig[session.channel_type].label}</span>
        </div>
      </td>
      <td className="px-4 py-3">
        <span className="text-sm text-fg-secondary">{session.user_identifier}</span>
      </td>
      <td className="px-4 py-3">
        <Badge variant={statusVariants[session.status]}>{session.status}</Badge>
      </td>
      <td className="px-4 py-3">
        <span className="font-mono text-sm text-fg-secondary">
          {session.duration_seconds ? formatDuration(session.duration_seconds) : '—'}
        </span>
      </td>
      <td className="px-4 py-3">
        <RatingBadge rating={customerFeedback?.rating} label="User" />
      </td>
      <td className="px-4 py-3">
        <button type="button" onClick={onRate} className="group flex items-center">
          <RatingBadge
            rating={supportFeedback?.rating}
            label="Expert"
            showAddButton={!supportFeedback}
          />
        </button>
      </td>
    </tr>
  )
}

function RatingBadge({
  rating,
  label,
  showAddButton,
}: {
  rating?: number
  label: string
  showAddButton?: boolean
}) {
  if (!rating && !showAddButton) {
    return <span className="text-sm text-fg-muted">—</span>
  }

  if (!rating && showAddButton) {
    return (
      <span className="flex items-center gap-1.5 rounded-lg border border-dashed border-fg-subtle/30 px-2.5 py-1.5 text-sm text-fg-muted transition-all group-hover:border-brand-500/50 group-hover:bg-brand-500/5 group-hover:text-brand-400">
        <ThumbsUp className="h-3.5 w-3.5" />
        <span className="text-xs font-medium">Rate</span>
      </span>
    )
  }

  const isPositive = rating === 2

  return (
    <Tooltip content={`${label}: ${isPositive ? 'Good' : 'Bad'}`} side="top">
      <span
        className={cn(
          'inline-flex h-8 w-8 items-center justify-center rounded-lg transition-transform hover:scale-110',
          isPositive ? 'bg-success/15 text-success' : 'bg-error/15 text-error',
        )}
      >
        {isPositive ? <ThumbsUp className="h-4 w-4" /> : <ThumbsDown className="h-4 w-4" />}
      </span>
    </Tooltip>
  )
}

function RatingDialog({
  session,
  open,
  onClose,
}: {
  session: Session
  open: boolean
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [rating, setRating] = useState<number | null>(null)
  const [comment, setComment] = useState('')

  const mutation = useMutation({
    mutationFn: (data: { rating: number; comment: string }) =>
      api
        .post(`sessions/${session.id}/feedback`, { json: { ...data, feedback_source: 'support' } })
        .json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] })
      onClose()
    },
  })

  const handleSubmit = () => {
    if (rating !== null) {
      mutation.mutate({ rating, comment })
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="Rate Session" size="sm">
      <div className="space-y-4">
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => setRating(2)}
            className={cn(
              'flex flex-1 items-center justify-center gap-2 rounded-xl border-2 py-3 text-sm font-semibold transition-all duration-200',
              rating === 2
                ? 'border-success bg-success/10 text-success scale-[1.02]'
                : 'border-fg-subtle/20 text-fg-muted hover:border-success/40 hover:text-success',
            )}
          >
            <ThumbsUp className="h-5 w-5" />
            Good
          </button>
          <button
            type="button"
            onClick={() => setRating(1)}
            className={cn(
              'flex flex-1 items-center justify-center gap-2 rounded-xl border-2 py-3 text-sm font-semibold transition-all duration-200',
              rating === 1
                ? 'border-error bg-error/10 text-error scale-[1.02]'
                : 'border-fg-subtle/20 text-fg-muted hover:border-error/40 hover:text-error',
            )}
          >
            <ThumbsDown className="h-5 w-5" />
            Bad
          </button>
        </div>

        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Add a note (optional)"
          className="w-full rounded-xl border border-fg-subtle/20 bg-bg-subtle px-4 py-3 text-sm text-fg-primary placeholder:text-fg-muted transition-colors focus:border-brand-500 focus:outline-none resize-none"
          rows={2}
        />

        <div className="flex gap-3">
          <Button variant="secondary" onClick={onClose} className="flex-1">
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            loading={mutation.isPending}
            disabled={rating === null}
            className="flex-1"
          >
            Save
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
