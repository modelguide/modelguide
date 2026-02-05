import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '~/lib/cn'

export interface PageHeaderProps {
  icon: LucideIcon
  iconColor: string
  iconBg: string
  title: string
  description: string
  actions?: ReactNode
}

export function PageHeader({
  icon: Icon,
  iconColor,
  iconBg,
  title,
  description,
  actions,
}: PageHeaderProps) {
  return (
    <div className="flex items-center justify-between animate-fade-up">
      <div className="flex items-center gap-3">
        <div
          className={cn(
            'flex h-10 w-10 items-center justify-center rounded-xl',
            iconBg,
          )}
        >
          <Icon className={cn('h-5 w-5', iconColor)} />
        </div>
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight text-fg-primary">
            {title}
          </h1>
          <p className="text-sm text-fg-muted">{description}</p>
        </div>
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  )
}
