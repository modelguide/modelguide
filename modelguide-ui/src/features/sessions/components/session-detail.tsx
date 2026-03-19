import {
  ExternalLink,
  FileCheck,
  HelpCircle,
  Link,
  type LucideIcon,
  Package,
  Ticket,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { Badge } from '~/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'
import { RatingBadge } from '~/components/ui/rating-badge'
import { Tooltip } from '~/components/ui/tooltip'
import { channelConfig } from '~/lib/channel-config'
import { formatDate, formatDuration } from '~/lib/utils'
import type {
  SessionDetail as SessionDetailType,
  SessionLink,
  SessionStatus,
  SopClassification,
} from '~/schemas/sessions'
import { Transcript } from './transcript'

const statusVariants: Record<SessionStatus, 'active' | 'completed' | 'abandoned'> = {
  active: 'active',
  completed: 'completed',
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

            <InfoItem label="Cost">
              <span className="text-sm text-fg-primary">
                {(() => {
                  const meta = (session.metadata ?? {}) as Record<string, unknown>
                  if (meta.cost_usd != null) return `$${Number(meta.cost_usd).toFixed(4)}`
                  if (meta.cost_credits != null) return `${String(meta.cost_credits)} credits`
                  return '\u2014'
                })()}
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
                  {meta.transcript_summary ? (
                    <p className="mb-3 text-sm italic text-fg-secondary">
                      {String(meta.transcript_summary)}
                    </p>
                  ) : null}
                  <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs text-fg-muted">
                    {meta.llm_model ? (
                      <span>
                        Model:{' '}
                        <span className="font-mono text-fg-secondary">
                          {String(meta.llm_model)}
                        </span>
                      </span>
                    ) : null}
                    {meta.llm_total_tokens ? (
                      <span>
                        Tokens:{' '}
                        <span className="text-fg-secondary">
                          {Number(meta.llm_input_tokens).toLocaleString()} in /{' '}
                          {Number(meta.llm_output_tokens).toLocaleString()} out
                        </span>
                      </span>
                    ) : null}
                    {/* Cost is shown in the header summary above */}
                    {meta.call_successful ? (
                      <span>
                        Result:{' '}
                        <span className="text-fg-secondary">{String(meta.call_successful)}</span>
                      </span>
                    ) : null}
                    {meta.termination_reason ? (
                      <span>
                        Ended:{' '}
                        <span className="text-fg-secondary">{String(meta.termination_reason)}</span>
                      </span>
                    ) : null}
                  </div>
                </div>
              )
            })()}
        </CardContent>
      </Card>

      {/* SOP Classification */}
      <SopClassificationCard classification={session.sopClassification} />

      {/* External Resources */}
      {session.links && session.links.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>External Resources</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {session.links.map((link) => (
                <ExternalLinkRow key={link.id} link={link} />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Transcript / Details */}
      <Card>
        <CardHeader>
          <CardTitle>
            {['voice', 'web', 'widget'].includes(session.channelType) ? 'Transcript' : 'Exchange'}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Transcript messages={session.messages || []} isActive={session.status === 'active'} />
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

const resourceIcons: Record<string, LucideIcon> = {
  ticket: Ticket,
  order: Package,
}

function ExternalLinkRow({ link }: { link: SessionLink }) {
  const Icon = resourceIcons[link.resourceType ?? ''] ?? Link
  return (
    <a
      href={link.url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-3 rounded-lg border border-fg-subtle/10 bg-bg-subtle px-3 py-2 transition-colors hover:border-brand-500/30 hover:bg-bg-subtle/80"
    >
      <Icon className="h-4 w-4 shrink-0 text-fg-muted" />
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg-primary">
        {link.title ?? link.url}
      </span>
      {link.connectorSlug && <Badge variant="default">{link.connectorSlug}</Badge>}
      <ExternalLink className="h-4 w-4 shrink-0 text-fg-muted" />
    </a>
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

function SopClassificationCard({ classification }: { classification: SopClassification }) {
  if (!classification) {
    return (
      <Card>
        <CardContent className="flex items-center gap-3 pt-6">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-bg-subtle">
            <FileCheck className="h-4 w-4 text-fg-muted" />
          </div>
          <div>
            <p className="text-sm font-medium text-fg-secondary">SOP Classification</p>
            <p className="text-xs text-fg-muted">No SOP was classified for this session</p>
          </div>
        </CardContent>
      </Card>
    )
  }

  if (classification.sopSlug === '__unknown__') {
    return (
      <Card>
        <CardContent className="flex items-center gap-3 pt-6">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-warning/10">
            <HelpCircle className="h-4 w-4 text-warning" />
          </div>
          <div>
            <p className="text-sm font-medium text-fg-secondary">SOP Classification</p>
            <p className="text-xs text-warning">
              Unknown SOP -- the agent could not match this session to a known procedure
            </p>
          </div>
          {classification.confidence != null && (
            <Badge variant="warning" className="ml-auto">
              {Math.round(classification.confidence * 100)}% confidence
            </Badge>
          )}
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardContent className="flex items-center gap-3 pt-6">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-500/10">
          <FileCheck className="h-4 w-4 text-brand-500" />
        </div>
        <div>
          <p className="text-sm font-medium text-fg-primary">
            {classification.sopName ?? classification.sopSlug}
          </p>
          <p className="text-xs text-fg-muted">
            SOP: <span className="font-mono">{classification.sopSlug}</span>
          </p>
        </div>
        {classification.confidence != null && (
          <Badge variant="brand" className="ml-auto">
            {Math.round(classification.confidence * 100)}% confidence
          </Badge>
        )}
      </CardContent>
    </Card>
  )
}
