import { AlertTriangle } from 'lucide-react'
import type { ReactNode } from 'react'
import { Badge } from '~/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'
import { RatingBadge } from '~/components/ui/rating-badge'
import { Tooltip } from '~/components/ui/tooltip'
import { channelConfig } from '~/lib/channel-config'
import { formatDate, formatDuration } from '~/lib/utils'
import type { SessionDetail as SessionDetailType, SessionStatus } from '~/schemas/sessions'
import { Transcript } from './transcript'

const statusVariants: Record<SessionStatus, 'active' | 'completed' | 'escalated' | 'abandoned'> = {
  active: 'active',
  completed: 'completed',
  escalated: 'escalated',
  abandoned: 'abandoned',
}

export interface SessionDetailProps {
  session: SessionDetailType
  onRate?: () => void
}

export function SessionDetail({ session, onRate }: SessionDetailProps) {
  const latestSupport = [...(session.feedback ?? [])]
    .reverse()
    .find((f) => f.feedbackSource === 'support')
  const latestCustomer = [...(session.feedback ?? [])]
    .reverse()
    .find((f) => f.feedbackSource === 'customer')

  return (
    <div className="space-y-6">
      {/* Escalation Banner */}
      {session.status === 'escalated' && session.escalationRef && (
        <div className="flex items-center gap-3 rounded-lg border border-warning/30 bg-warning-muted p-4">
          <AlertTriangle className="h-5 w-5 text-warning" />
          <div>
            <p className="text-sm font-semibold text-warning">Session Escalated</p>
            <p className="mt-0.5 text-xs text-fg-secondary">
              Reference: <span className="font-mono">{session.escalationRef}</span>
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
                    <div>{formatDate(session.startedAt, { format: 'date' })}</div>
                    <div className="text-fg-muted">
                      {formatDate(session.startedAt, { format: 'time' })}
                    </div>
                  </div>
                }
              >
                <span className="cursor-default text-sm text-fg-primary">
                  {formatDate(session.startedAt, { format: 'relative' })}
                </span>
              </Tooltip>
            </InfoItem>

            <InfoItem label="Agent">
              <span className="text-sm font-medium text-fg-primary">{session.agent.name}</span>
            </InfoItem>

            <InfoItem label="Channel">
              <div className="flex items-center gap-2 text-fg-primary">
                {channelConfig[session.channelType].icon}
                <span className="text-sm">{channelConfig[session.channelType].label}</span>
              </div>
            </InfoItem>

            <InfoItem label="User">
              <span className="text-sm text-fg-primary">{session.userIdentifier}</span>
            </InfoItem>

            <InfoItem label="Status">
              <Badge variant={statusVariants[session.status]}>{session.status}</Badge>
            </InfoItem>

            <InfoItem label="Duration">
              <span className="text-sm text-fg-primary">
                {session.durationSeconds ? formatDuration(session.durationSeconds) : 'Ongoing'}
              </span>
            </InfoItem>

            <InfoItem label="User Rating">
              <RatingBadge rating={latestCustomer?.rating} size="sm" />
            </InfoItem>

            <InfoItem label="Expert Rating">
              {latestSupport ? (
                onRate ? (
                  <button type="button" onClick={onRate} className="group cursor-pointer">
                    <RatingBadge rating={latestSupport.rating} size="sm" />
                  </button>
                ) : (
                  <RatingBadge rating={latestSupport.rating} size="sm" />
                )
              ) : onRate ? (
                <button type="button" onClick={onRate} className="group cursor-pointer">
                  <RatingBadge showAddButton size="sm" />
                </button>
              ) : (
                <RatingBadge size="sm" />
              )}
            </InfoItem>
          </div>

          <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 border-t border-fg-subtle/10 pt-4 text-xs text-fg-muted">
            <span>Started: {formatDate(session.startedAt)}</span>
            {session.endedAt && <span>Ended: {formatDate(session.endedAt)}</span>}
            {session.externalId && <span>External ID: {session.externalId}</span>}
          </div>

          {/* Call metadata from ElevenLabs */}
          {session.metadata &&
            Object.keys(session.metadata).length > 0 &&
            (() => {
              const meta = session.metadata as Record<string, unknown>
              return (
                <div className="mt-4 border-t border-fg-subtle/10 pt-4">
                  {meta.transcript_summary && (
                    <p className="mb-3 text-sm italic text-fg-secondary">
                      {String(meta.transcript_summary)}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs text-fg-muted">
                    {meta.llm_model && (
                      <span>
                        Model:{' '}
                        <span className="font-mono text-fg-secondary">
                          {String(meta.llm_model)}
                        </span>
                      </span>
                    )}
                    {meta.llm_total_tokens ? (
                      <span>
                        Tokens:{' '}
                        <span className="text-fg-secondary">
                          {Number(meta.llm_input_tokens).toLocaleString()} in /{' '}
                          {Number(meta.llm_output_tokens).toLocaleString()} out
                        </span>
                      </span>
                    ) : null}
                    {meta.cost_credits ? (
                      <span>
                        Cost:{' '}
                        <span className="text-fg-secondary">
                          {String(meta.cost_credits)} credits
                        </span>
                      </span>
                    ) : null}
                    {meta.call_successful && (
                      <span>
                        Result:{' '}
                        <span className="text-fg-secondary">{String(meta.call_successful)}</span>
                      </span>
                    )}
                    {meta.termination_reason && (
                      <span>
                        Ended:{' '}
                        <span className="text-fg-secondary">{String(meta.termination_reason)}</span>
                      </span>
                    )}
                  </div>
                </div>
              )
            })()}
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

      {/* All Feedback */}
      {session.feedback && session.feedback.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Feedback</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {session.feedback.map((fb) => (
                <div
                  key={fb.id}
                  className="flex items-start gap-3 rounded-lg border border-fg-subtle/10 bg-bg-subtle p-3"
                >
                  <RatingBadge rating={fb.rating} size="xs" />
                  <div>
                    <p className="text-xs font-medium text-fg-muted">
                      <span className="capitalize">
                        {fb.feedbackSource === 'customer' ? 'User' : 'Expert'}
                      </span>
                      {fb.userIdentifier && (
                        <span className="text-fg-subtle"> &middot; {fb.userIdentifier}</span>
                      )}
                      {fb.updatedAt && <span className="text-fg-subtle"> &middot; edited</span>}
                    </p>
                    {fb.comment && <p className="mt-1 text-sm text-fg-primary">{fb.comment}</p>}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
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
