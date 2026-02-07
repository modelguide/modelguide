import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '~/lib/cn'

interface EmptyStateProps {
  icon?: LucideIcon
  title: string
  description?: string
  action?: ReactNode
  className?: string
}

export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-lg border border-fg-subtle/20 bg-bg-elevated px-6 py-12 text-center',
        className,
      )}
    >
      {Icon ? (
        <div className="mb-4 rounded-full bg-brand-500/10 p-3">
          <Icon className="h-6 w-6 text-brand-500" />
        </div>
      ) : null}
      <h3 className="font-display text-base font-medium text-fg-primary">{title}</h3>
      {description ? (
        <p className="mt-2 max-w-sm font-sans text-sm text-fg-secondary">{description}</p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  )
}
