import { Link } from '@tanstack/react-router'
import {
  ExternalLink,
  Link as LinkIcon,
  Loader2,
  type LucideIcon,
  Package,
  Sparkles,
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
  onClassify?: () => void
  isClassifying?: boolean
}

export function SessionDetail({ session, onRate, onClassify, isClassifying }: SessionDetailProps) {
  const latestSupport = [...(session.feedback ?? [])]
    .reverse()
    .find((f) => f.feedbackSource === 'support')
  const latestCustomer = [...(session.feedback ?? [])]
    .reverse()
    .find((f) => f.feedbackSource === 'customer')

  return (
    <div className="space-y-6">
      {/* Session Info — compact panel */}
      <Card>
        <CardContent className="pt-5 pb-3">
          <div className="grid gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-5">
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

            {session.mode === 'simulation' && (
              <InfoItem label="Mode">
                <Badge variant="warning" dot>
                  Simulation
                </Badge>
              </InfoItem>
            )}

            <InfoItem label="Duration">
              <span className="text-sm text-fg-primary">
                {session.durationSeconds ? formatDuration(session.durationSeconds) : 'Ongoing'}
              </span>
            </InfoItem>

            <InfoItem label="SOP">
              <SopInline
                classification={session.sopClassification}
                onClassify={onClassify}
                isClassifying={isClassifying}
              />
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

            <InfoItem label="Time">
              <span className="text-sm text-fg-primary">
                {formatDate(session.startedAt, { format: 'relative' })}
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
          </div>

          <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 border-t border-fg-subtle/10 pt-2 text-xs text-fg-muted">
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
                <div className="mt-3 border-t border-fg-subtle/10 pt-3">
                  {meta.transcript_summary ? (
                    <p className="mb-2 text-sm italic text-fg-secondary">
                      {String(meta.transcript_summary)}
                    </p>
                  ) : null}
                  <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-fg-muted">
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
  const Icon = resourceIcons[link.resourceType ?? ''] ?? LinkIcon
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

function SopInline({
  classification,
  onClassify,
  isClassifying,
}: { classification: SopClassification; onClassify?: () => void; isClassifying?: boolean }) {
  if (!classification) {
    if (onClassify) {
      return (
        <button
          type="button"
          onClick={onClassify}
          disabled={isClassifying}
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-fg-secondary transition-colors hover:bg-bg-subtle hover:text-fg-primary disabled:opacity-50"
        >
          {isClassifying ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Sparkles className="h-3.5 w-3.5" />
          )}
          {isClassifying ? 'Classifying…' : 'Classify'}
        </button>
      )
    }
    return <span className="text-sm text-fg-muted">{'\u2014'}</span>
  }

  if (classification.unknown || !classification.sopSlug) {
    return (
      <div className="flex items-center gap-2">
        <Badge variant="warning">Unknown</Badge>
        {classification.confidence != null && (
          <span className="text-xs text-fg-muted">
            {Math.round(classification.confidence * 100)}%
          </span>
        )}
        {classification.source === 'server' && (
          <Tooltip content="Classified by ModelGuide" side="top">
            <Badge variant="info" className="px-1.5 py-0 text-[10px]">
              Auto
            </Badge>
          </Tooltip>
        )}
      </div>
    )
  }

  const confidenceColor =
    classification.confidence != null
      ? classification.confidence >= 0.8
        ? 'text-success'
        : classification.confidence >= 0.5
          ? 'text-warning'
          : 'text-error'
      : 'text-fg-muted'

  return (
    <div className="flex items-center gap-2">
      <Link to="/sops" className="transition-colors hover:text-brand-500">
        <Badge variant="brand" className="cursor-pointer hover:bg-brand-500/20">
          {classification.sopName ?? classification.sopSlug}
        </Badge>
      </Link>
      {classification.confidence != null && (
        <span className={`text-xs ${confidenceColor}`}>
          {Math.round(classification.confidence * 100)}%
        </span>
      )}
      {classification.source === 'server' && (
        <Tooltip content="Classified by ModelGuide" side="top">
          <Badge variant="info" className="px-1.5 py-0 text-[10px]">
            Auto
          </Badge>
        </Tooltip>
      )}
    </div>
  )
}
