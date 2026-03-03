import { MessageSquare, MousePointer, Radio, Terminal } from 'lucide-react'
import { Badge } from '~/components/ui/badge'
import type { SopTrigger } from '~/schemas/sops'

interface SopTriggerBadgeProps {
  trigger: SopTrigger
}

export function SopTriggerBadge({ trigger }: SopTriggerBadgeProps) {
  switch (trigger.type) {
    case 'channel':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs text-fg-secondary">
          <Radio className="h-3 w-3" />
          <span className="capitalize">{trigger.config.channelTypes.join(', ')}</span>
        </span>
      )
    case 'intent_detected':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs text-fg-secondary">
          <MessageSquare className="h-3 w-3" />
          <span>
            {trigger.config.patterns.length} pattern
            {trigger.config.patterns.length !== 1 ? 's' : ''}
          </span>
        </span>
      )
    case 'tool_present':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs text-fg-secondary">
          <Terminal className="h-3 w-3" />
          <span>
            {trigger.config.toolSlugs.length} tool
            {trigger.config.toolSlugs.length !== 1 ? 's' : ''}
          </span>
        </span>
      )
    case 'manual':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs text-fg-secondary">
          <MousePointer className="h-3 w-3" />
          <span>Manual</span>
        </span>
      )
  }
}

export function SopTriggerDetail({ trigger }: SopTriggerBadgeProps) {
  switch (trigger.type) {
    case 'channel':
      return (
        <div className="flex flex-wrap gap-1.5">
          {trigger.config.channelTypes.map((ch) => (
            <Badge key={ch} variant="info">
              {ch}
            </Badge>
          ))}
        </div>
      )
    case 'intent_detected':
      return (
        <div className="flex flex-wrap gap-1.5">
          {trigger.config.patterns.map((p) => (
            <Badge key={p} variant="default">
              {p}
            </Badge>
          ))}
        </div>
      )
    case 'tool_present':
      return (
        <div className="flex flex-wrap gap-1.5">
          {trigger.config.toolSlugs.map((slug) => (
            <span
              key={slug}
              className="inline-flex items-center gap-1 rounded-md bg-brand-500/[0.06] px-2 py-0.5 font-mono text-xs text-brand-400/80 ring-1 ring-brand-500/10"
            >
              <Terminal className="h-3 w-3" />
              {slug}
            </span>
          ))}
        </div>
      )
    case 'manual':
      return <p className="text-sm text-fg-secondary">Manual activation</p>
  }
}
