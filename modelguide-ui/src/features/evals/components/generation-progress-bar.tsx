import { cn } from '~/lib/cn'

export interface GenerationProgressBarProps {
  completed: number
  total: number
  accepted: number
  rejected: number
  status: string
}

export function GenerationProgressBar({
  completed,
  total,
  accepted,
  rejected,
  status,
}: GenerationProgressBarProps) {
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0

  const statusText =
    status === 'deriving_dimensions'
      ? 'Deriving dimensions from SOP...'
      : status === 'generating'
        ? `Generating case ${completed}/${total}...`
        : status === 'completed'
          ? rejected > 0
            ? `Done — ${accepted} accepted, ${rejected} rejected`
            : `Done — ${accepted} test cases generated`
          : status === 'failed'
            ? 'Generation failed'
            : 'Processing...'

  return (
    <div className="w-full space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="text-fg-secondary">{statusText}</span>
        {total > 0 ? <span className="font-mono text-fg-muted">{percent}%</span> : null}
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-bg-subtle">
        {status === 'deriving_dimensions' ? (
          <div className="h-full w-1/4 animate-[indeterminate_1.5s_ease-in-out_infinite] rounded-full bg-brand-500" />
        ) : (
          <div
            className={cn(
              'h-full rounded-full transition-all duration-500 ease-out',
              status === 'completed'
                ? 'bg-success'
                : status === 'failed'
                  ? 'bg-error'
                  : 'bg-brand-500 animate-pulse',
            )}
            style={{ width: `${percent}%` }}
          />
        )}
      </div>
      {total > 0 && status === 'generating' ? (
        <div className="flex gap-3 text-xs text-fg-muted">
          <span className="text-success">{accepted} accepted</span>
          <span className="text-error">{rejected} rejected</span>
        </div>
      ) : null}
    </div>
  )
}
