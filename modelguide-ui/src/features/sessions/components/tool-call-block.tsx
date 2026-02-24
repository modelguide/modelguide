import { Check, ChevronDown, ChevronRight, Settings, X } from 'lucide-react'
import { useState } from 'react'
import { cn } from '~/lib/cn'

export interface ToolCallBlockProps {
  toolName: string
  input: Record<string, unknown>
  output: Record<string, unknown>
  status: 'success' | 'error'
  latencyMs?: number | null
}

export function ToolCallBlock({ toolName, input, output, status, latencyMs }: ToolCallBlockProps) {
  const [expanded, setExpanded] = useState(false)

  // Format tool name for display (e.g., "glowbox_store_add_to_cart" -> "Add to Cart")
  const displayName =
    toolName
      .split('_')
      .slice(1)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ') || toolName

  return (
    <div className="mx-auto max-w-md">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className={cn(
          'flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors',
          status === 'success'
            ? 'border-success/20 bg-success/5 hover:bg-success/10'
            : 'border-error/20 bg-error/5 hover:bg-error/10',
        )}
      >
        <div
          className={cn(
            'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
            status === 'success' ? 'bg-success/20' : 'bg-error/20',
          )}
        >
          <Settings
            className={cn('h-4 w-4', status === 'success' ? 'text-success' : 'text-error')}
          />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-sans text-sm font-medium text-fg-primary">{displayName}</span>
            {status === 'success' ? (
              <Check className="h-3.5 w-3.5 text-success" />
            ) : (
              <X className="h-3.5 w-3.5 text-error" />
            )}
          </div>
          {latencyMs ? (
            <span className="font-sans text-xs text-fg-muted">{latencyMs}ms</span>
          ) : null}
        </div>

        {expanded ? (
          <ChevronDown className="h-4 w-4 text-fg-muted" />
        ) : (
          <ChevronRight className="h-4 w-4 text-fg-muted" />
        )}
      </button>

      {expanded ? (
        <div className="mt-2 overflow-hidden rounded-xl border border-fg-subtle/10 bg-bg-elevated">
          <div className="border-b border-fg-subtle/10 p-4">
            <p className="mb-2 font-sans text-xs font-medium uppercase tracking-wide text-fg-muted">
              Request
            </p>
            <pre className="overflow-x-auto rounded-lg bg-bg-base p-3 font-mono text-xs text-fg-secondary">
              {JSON.stringify(input, null, 2)}
            </pre>
          </div>
          <div className="p-4">
            <p className="mb-2 font-sans text-xs font-medium uppercase tracking-wide text-fg-muted">
              Response
            </p>
            <pre
              className={cn(
                'overflow-x-auto rounded-lg bg-bg-base p-3 font-mono text-xs',
                status === 'success' ? 'text-fg-secondary' : 'text-error',
              )}
            >
              {JSON.stringify(output, null, 2)}
            </pre>
          </div>
        </div>
      ) : null}
    </div>
  )
}
