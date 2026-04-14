import { Link } from '@tanstack/react-router'
import { Zap } from 'lucide-react'
import { cn } from '~/lib/cn'

interface CompiledFromInfo {
  sopId: string
  sopName: string
  stepCount: number
  toolCount: number
}

interface CompileSummaryBarProps {
  compiledFrom: CompiledFromInfo
  promptLength: number
  compiledAt?: string
  className?: string
}

function formatRelativeDate(iso: string): string {
  const date = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60_000)

  if (diffMins < 1) return 'just now'
  if (diffMins < 60) return `${diffMins}m ago`
  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `${diffHours}h ago`
  const diffDays = Math.floor(diffHours / 24)
  if (diffDays < 7) return `${diffDays}d ago`
  return date.toLocaleDateString()
}

export function CompileSummaryBar({
  compiledFrom,
  promptLength,
  compiledAt,
  className,
}: CompileSummaryBarProps) {
  return (
    <div className={cn('rounded-xl bg-bg-subtle border-t-2 border-brand-500/20 p-4', className)}>
      <div className="flex items-center gap-4 flex-wrap">
        <Link
          to="/sops/$id"
          params={{ id: compiledFrom.sopId }}
          className="flex items-center gap-2 hover:underline"
        >
          <Zap className="h-3.5 w-3.5 text-brand-400" />
          <span className="text-sm font-medium text-fg-primary">{compiledFrom.sopName}</span>
        </Link>
        <div className="h-4 w-px bg-fg-subtle/20" />
        <div className="flex items-center gap-4 text-xs text-fg-muted">
          <span>
            <strong className="text-fg-secondary">{compiledFrom.stepCount}</strong> steps
          </span>
          <span>
            <strong className="text-fg-secondary">{compiledFrom.toolCount}</strong> tools
          </span>
          <span>
            <strong className="text-fg-secondary">{promptLength.toLocaleString()}</strong> chars
          </span>
        </div>
        {compiledAt ? (
          <>
            <div className="h-4 w-px bg-fg-subtle/20" />
            <span className="text-xs text-fg-muted">{formatRelativeDate(compiledAt)}</span>
          </>
        ) : null}
      </div>
    </div>
  )
}
