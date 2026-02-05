import { ThumbsDown, ThumbsUp } from 'lucide-react'
import { cn } from '~/lib/cn'
import { Tooltip } from './tooltip'

export interface RatingBadgeProps {
  rating?: number
  label?: string
  showAddButton?: boolean
  size?: 'xs' | 'sm' | 'md'
}

export function RatingBadge({ rating, label, showAddButton, size = 'md' }: RatingBadgeProps) {
  if (!rating && !showAddButton) {
    return <span className="text-sm text-fg-muted">—</span>
  }

  if (!rating && showAddButton) {
    return (
      <span className="flex items-center gap-1.5 rounded-lg border border-dashed border-fg-subtle/30 px-2.5 py-1.5 text-sm text-fg-muted transition-all group-hover:border-brand-500/50 group-hover:bg-brand-500/5 group-hover:text-brand-400">
        <ThumbsUp className="h-3.5 w-3.5" />
        <span className="text-xs font-medium">Rate</span>
      </span>
    )
  }

  const isPositive = rating === 2
  const sizeClasses = {
    xs: 'h-6 w-6 rounded-full',
    sm: 'h-7 w-7 rounded-lg',
    md: 'h-8 w-8 rounded-lg',
  }[size]
  const iconClasses = {
    xs: 'h-3 w-3',
    sm: 'h-3.5 w-3.5',
    md: 'h-4 w-4',
  }[size]

  const badge = (
    <span
      className={cn(
        'inline-flex items-center justify-center rounded-lg transition-transform hover:scale-110',
        sizeClasses,
        isPositive ? 'bg-success/15 text-success' : 'bg-error/15 text-error',
      )}
    >
      {isPositive ? (
        <ThumbsUp className={iconClasses} />
      ) : (
        <ThumbsDown className={iconClasses} />
      )}
    </span>
  )

  if (label) {
    return (
      <Tooltip content={`${label}: ${isPositive ? 'Good' : 'Bad'}`} side="top">
        {badge}
      </Tooltip>
    )
  }

  return badge
}
