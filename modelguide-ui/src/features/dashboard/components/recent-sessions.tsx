import { Link, useNavigate } from '@tanstack/react-router'
import { ArrowRight, Globe, MessageCircle, Phone, Send, Slack } from 'lucide-react'
import type { ReactNode } from 'react'
import { Badge } from '~/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'
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

export interface RecentSessionsProps {
  sessions: Session[]
  isLoading?: boolean
}

export function RecentSessions({ sessions, isLoading }: RecentSessionsProps) {
  const navigate = useNavigate()

  return (
    <Card className="animate-fade-up stagger-5">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Recent Sessions</CardTitle>
        <Link
          to="/sessions"
          className="flex items-center gap-1 font-sans text-sm text-brand hover:text-brand/80"
        >
          View all
          <ArrowRight className="h-4 w-4" />
        </Link>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-3">
            {['skel-1', 'skel-2', 'skel-3', 'skel-4', 'skel-5'].map((key) => (
              <div key={key} className="h-16 animate-pulse rounded-lg bg-bg-subtle" />
            ))}
          </div>
        ) : sessions.length === 0 ? (
          <p className="py-8 text-center font-sans text-sm text-fg-muted">No recent sessions</p>
        ) : (
          <div className="space-y-2">
            {sessions.map((session) => (
              // biome-ignore lint/a11y/useKeyWithClickEvents: Keyboard nav in backlog
              <div
                key={session.id}
                onClick={() => navigate({ to: '/sessions/$id', params: { id: session.id } })}
                className="group flex cursor-pointer items-center justify-between rounded-lg p-3 transition-colors hover:bg-bg-subtle"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand/10 text-brand">
                    {channelConfig[session.channel_type].icon}
                  </div>
                  <div>
                    <p className="font-sans text-sm font-medium text-fg-primary">
                      {session.agent.name}
                    </p>
                    <p className="font-sans text-xs text-fg-muted">
                      {formatDate(session.started_at, { format: 'relative' })}
                      {session.duration_seconds
                        ? ` • ${formatDuration(session.duration_seconds)}`
                        : ''}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Badge variant={statusVariants[session.status]}>{session.status}</Badge>
                  <ArrowRight className="h-4 w-4 text-fg-muted opacity-0 transition-opacity group-hover:opacity-100" />
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
