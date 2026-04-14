import { Link } from '@tanstack/react-router'
import { Zap } from 'lucide-react'
import { cn } from '~/lib/cn'

interface SopInfo {
  sopId: string
  sopName: string
  stepCount: number
}

interface CompiledFromInfo {
  sops: SopInfo[]
  guardrailIds: string[]
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
    <div className={cn('flex flex-col gap-2', className)}>
      {/* One panel per SOP — shows per-SOP step count */}
      {compiledFrom.sops.map((sop) => (
        <div
          key={sop.sopId}
          className="rounded-xl bg-bg-subtle border-t-2 border-brand-500/20 px-4 py-3"
        >
          <div className="flex items-center gap-3">
            <Zap className="h-3.5 w-3.5 shrink-0 text-brand-400" />
            <Link
              to="/sops/$id"
              params={{ id: sop.sopId }}
              className="text-sm font-medium text-fg-primary hover:underline truncate"
            >
              {sop.sopName}
            </Link>
            <span className="ml-auto shrink-0 text-xs text-fg-muted">
              <strong className="text-fg-secondary">{sop.stepCount}</strong> steps
            </span>
          </div>
        </div>
      ))}

      {/* Totals row — aggregate for the compiled prompt */}
      <div className="flex items-center gap-4 px-1 text-xs text-fg-muted">
        <span>
          <strong className="text-fg-secondary">{compiledFrom.toolCount}</strong> tools
        </span>
        <span>
          <strong className="text-fg-secondary">{promptLength.toLocaleString()}</strong> chars
        </span>
        {compiledAt ? (
          <>
            <div className="h-3 w-px bg-fg-subtle/20" />
            <span>{formatRelativeDate(compiledAt)}</span>
          </>
        ) : null}
      </div>
    </div>
  )
}
