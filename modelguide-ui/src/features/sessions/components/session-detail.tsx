import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  Globe,
  MessageCircle,
  Phone,
  Send,
  Slack,
  ThumbsDown,
  ThumbsUp,
} from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'
import { Dialog } from '~/components/ui/dialog'
import { Tooltip } from '~/components/ui/tooltip'
import { api } from '~/lib/api'
import { cn } from '~/lib/cn'
import { formatDate, formatDuration } from '~/lib/utils'
import type { ChannelType, Session, SessionStatus } from '~/schemas/sessions'
import { Transcript } from './transcript'

const statusVariants: Record<SessionStatus, 'active' | 'completed' | 'escalated' | 'abandoned'> = {
  active: 'active',
  completed: 'completed',
  escalated: 'escalated',
  abandoned: 'abandoned',
}

const channelConfig: Record<ChannelType, { icon: ReactNode; label: string }> = {
  voice: { icon: <Phone className="h-4 w-4" />, label: 'Voice' },
  web: { icon: <Globe className="h-4 w-4" />, label: 'Web' },
  api: { icon: <Send className="h-4 w-4" />, label: 'API' },
  slack: { icon: <Slack className="h-4 w-4" />, label: 'Slack' },
  widget: { icon: <MessageCircle className="h-4 w-4" />, label: 'Widget' },
  sms: { icon: <MessageCircle className="h-4 w-4" />, label: 'SMS' },
  whatsapp: { icon: <MessageCircle className="h-4 w-4" />, label: 'WhatsApp' },
}

export interface SessionDetailProps {
  session: Session
}

export function SessionDetail({ session }: SessionDetailProps) {
  const [showRatingDialog, setShowRatingDialog] = useState(false)
  const supportFeedback = session.feedback?.find((f) => f.feedback_source === 'support')
  const customerFeedback = session.feedback?.find((f) => f.feedback_source === 'customer')

  return (
    <div className="space-y-6">
      {/* Escalation Banner */}
      {session.status === 'escalated' && session.escalation_ref && (
        <div className="flex items-center gap-3 rounded-lg border border-warning/30 bg-warning-muted p-4">
          <AlertTriangle className="h-5 w-5 text-warning" />
          <div>
            <p className="text-sm font-semibold text-warning">Session Escalated</p>
            <p className="mt-0.5 text-xs text-fg-secondary">
              Reference: <span className="font-mono">{session.escalation_ref}</span>
            </p>
          </div>
        </div>
      )}

      {/* Session Info - Matching sessions list columns */}
      <Card>
        <CardContent className="pt-6">
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            <InfoItem label="Time">
              <Tooltip
                content={
                  <div className="text-center">
                    <div>{formatDate(session.started_at, { format: 'date' })}</div>
                    <div className="text-fg-muted">
                      {formatDate(session.started_at, { format: 'time' })}
                    </div>
                  </div>
                }
              >
                <span className="cursor-default text-sm text-fg-primary">
                  {formatDate(session.started_at, { format: 'relative' })}
                </span>
              </Tooltip>
            </InfoItem>

            <InfoItem label="Agent">
              <span className="text-sm font-medium text-fg-primary">{session.agent.name}</span>
            </InfoItem>

            <InfoItem label="Channel">
              <div className="flex items-center gap-2 text-fg-primary">
                {channelConfig[session.channel_type].icon}
                <span className="text-sm">{channelConfig[session.channel_type].label}</span>
              </div>
            </InfoItem>

            <InfoItem label="User">
              <span className="text-sm text-fg-primary">{session.user_identifier}</span>
            </InfoItem>

            <InfoItem label="Status">
              <Badge variant={statusVariants[session.status]}>{session.status}</Badge>
            </InfoItem>

            <InfoItem label="Duration">
              <span className="text-sm text-fg-primary">
                {session.duration_seconds ? formatDuration(session.duration_seconds) : 'Ongoing'}
              </span>
            </InfoItem>

            <InfoItem label="User Rating">
              <RatingDisplay rating={customerFeedback?.rating} />
            </InfoItem>

            <InfoItem label="Expert Rating">
              <div className="flex items-center gap-2">
                <RatingDisplay rating={supportFeedback?.rating} />
                {!supportFeedback && (
                  <Button variant="secondary" size="sm" onClick={() => setShowRatingDialog(true)}>
                    Rate
                  </Button>
                )}
              </div>
            </InfoItem>
          </div>

          <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 border-t border-fg-subtle/10 pt-4 text-xs text-fg-muted">
            <span>Started: {formatDate(session.started_at)}</span>
            {session.ended_at && <span>Ended: {formatDate(session.ended_at)}</span>}
            <span>External ID: {session.external_id}</span>
          </div>
        </CardContent>
      </Card>

      {/* Transcript */}
      <Card>
        <CardHeader>
          <CardTitle>Transcript</CardTitle>
        </CardHeader>
        <CardContent>
          <Transcript messages={session.messages || []} />
        </CardContent>
      </Card>

      {/* Feedback Comments */}
      {session.feedback?.some((f) => f.comment) && (
        <Card>
          <CardHeader>
            <CardTitle>Feedback Notes</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {session.feedback
                .filter((fb) => fb.comment)
                .map((fb) => (
                  <div
                    key={fb.id}
                    className="flex items-start gap-3 rounded-lg border border-fg-subtle/10 bg-bg-subtle p-3"
                  >
                    <span
                      className={cn(
                        'inline-flex h-6 w-6 items-center justify-center rounded-full',
                        fb.rating === 2 ? 'bg-success/15 text-success' : 'bg-error/15 text-error',
                      )}
                    >
                      {fb.rating === 2 ? (
                        <ThumbsUp className="h-3 w-3" />
                      ) : (
                        <ThumbsDown className="h-3 w-3" />
                      )}
                    </span>
                    <div>
                      <p className="text-xs font-medium text-fg-muted capitalize">
                        {fb.feedback_source === 'customer' ? 'User' : 'Expert'}
                      </p>
                      <p className="mt-1 text-sm text-fg-primary">{fb.comment}</p>
                    </div>
                  </div>
                ))}
            </div>
          </CardContent>
        </Card>
      )}

      {showRatingDialog && (
        <RatingDialog
          session={session}
          open={showRatingDialog}
          onClose={() => setShowRatingDialog(false)}
        />
      )}
    </div>
  )
}

function InfoItem({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium text-fg-muted">{label}</p>
      <div className="mt-1">{children}</div>
    </div>
  )
}

function RatingDisplay({ rating }: { rating?: number }) {
  if (!rating) {
    return <span className="text-sm text-fg-muted">—</span>
  }

  const isPositive = rating === 2

  return (
    <span
      className={cn(
        'inline-flex h-7 w-7 items-center justify-center rounded-full',
        isPositive ? 'bg-success/15 text-success' : 'bg-error/15 text-error',
      )}
    >
      {isPositive ? <ThumbsUp className="h-3.5 w-3.5" /> : <ThumbsDown className="h-3.5 w-3.5" />}
    </span>
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
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setRating(2)}
            className={cn(
              'flex flex-1 items-center justify-center gap-2 rounded-lg border py-2.5 text-sm font-medium transition-colors',
              rating === 2
                ? 'border-success bg-success/10 text-success'
                : 'border-fg-subtle/20 text-fg-muted hover:border-success/40 hover:text-success',
            )}
          >
            <ThumbsUp className="h-4 w-4" />
            Good
          </button>
          <button
            type="button"
            onClick={() => setRating(1)}
            className={cn(
              'flex flex-1 items-center justify-center gap-2 rounded-lg border py-2.5 text-sm font-medium transition-colors',
              rating === 1
                ? 'border-error bg-error/10 text-error'
                : 'border-fg-subtle/20 text-fg-muted hover:border-error/40 hover:text-error',
            )}
          >
            <ThumbsDown className="h-4 w-4" />
            Bad
          </button>
        </div>

        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Add a note (optional)"
          className="w-full rounded-lg border border-fg-subtle/20 bg-bg-subtle px-3 py-2 text-sm text-fg-primary placeholder:text-fg-muted transition-colors focus:border-brand-500 focus:outline-none resize-none"
          rows={2}
        />

        <div className="flex gap-2">
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
