import { AlertTriangle } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'
import { RatingBadge } from '~/components/ui/rating-badge'
import { RatingDialog } from '~/components/ui/rating-dialog'
import { Tooltip } from '~/components/ui/tooltip'
import { channelConfig } from '~/lib/channel-config'
import { formatDate, formatDuration } from '~/lib/utils'
import type { Session, SessionStatus } from '~/schemas/sessions'
import { Transcript } from './transcript'

const statusVariants: Record<SessionStatus, 'active' | 'completed' | 'escalated' | 'abandoned'> = {
  active: 'active',
  completed: 'completed',
  escalated: 'escalated',
  abandoned: 'abandoned',
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
              <RatingBadge rating={customerFeedback?.rating} size="sm" />
            </InfoItem>

            <InfoItem label="Expert Rating">
              <div className="flex items-center gap-2">
                <RatingBadge rating={supportFeedback?.rating} size="sm" />
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
                    <RatingBadge rating={fb.rating} size="xs" />
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
          sessionId={session.id}
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

