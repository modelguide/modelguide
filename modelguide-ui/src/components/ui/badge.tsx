import { type VariantProps, cva } from 'class-variance-authority'
import type { HTMLAttributes } from 'react'
import { cn } from '~/lib/cn'

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium',
  {
    variants: {
      variant: {
        default: 'bg-bg-subtle text-fg-secondary',
        active: 'bg-info-muted text-info animate-breathe',
        completed: 'bg-success-muted text-success',
        escalated: 'bg-warning-muted text-warning',
        abandoned: 'bg-error-muted text-error',
        success: 'bg-success-muted text-success',
        error: 'bg-error-muted text-error',
        warning: 'bg-warning-muted text-warning',
        info: 'bg-info-muted text-info',
        brand: 'bg-brand-950 text-brand-400',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  dot?: boolean
}

function Badge({ className, variant, dot, children, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props}>
      {dot ? (
        <span
          className={cn(
            'h-1.5 w-1.5 rounded-full',
            variant === 'active' && 'bg-info',
            variant === 'completed' && 'bg-success',
            variant === 'escalated' && 'bg-warning',
            variant === 'abandoned' && 'bg-error',
            variant === 'success' && 'bg-success',
            variant === 'error' && 'bg-error',
            variant === 'warning' && 'bg-warning',
            variant === 'info' && 'bg-info',
            variant === 'brand' && 'bg-brand-500',
            (!variant || variant === 'default') && 'bg-fg-muted',
          )}
        />
      ) : null}
      {children}
    </span>
  )
}

export { Badge, badgeVariants }
