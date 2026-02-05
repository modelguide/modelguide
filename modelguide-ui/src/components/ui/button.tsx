import { type VariantProps, cva } from 'class-variance-authority'
import { type ButtonHTMLAttributes, forwardRef } from 'react'
import { cn } from '~/lib/cn'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-all duration-200 disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base',
  {
    variants: {
      variant: {
        primary:
          'bg-brand-500 text-white shadow-lg shadow-brand-500/20 hover:bg-brand-400 hover:shadow-brand-500/30 hover:-translate-y-0.5 active:translate-y-0 active:bg-brand-600',
        secondary:
          'bg-bg-subtle text-fg-primary border border-fg-subtle/20 hover:bg-bg-muted hover:border-fg-subtle/40 hover:-translate-y-0.5 active:translate-y-0',
        ghost: 'text-fg-secondary hover:text-fg-primary hover:bg-bg-subtle/80',
        danger:
          'bg-error text-white shadow-lg shadow-error/20 hover:bg-red-500 hover:shadow-error/30 hover:-translate-y-0.5 active:translate-y-0 active:bg-red-700',
        link: 'text-brand-500 hover:text-brand-400 underline-offset-4 hover:underline',
      },
      size: {
        sm: 'h-8 px-3 text-xs',
        md: 'h-10 px-4 text-sm',
        lg: 'h-12 px-6 text-base',
        icon: 'h-10 w-10',
        'icon-sm': 'h-8 w-8',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  },
)

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  loading?: boolean
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, loading, disabled, children, ...props }, ref) => {
    return (
      <button
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        disabled={disabled || loading}
        {...props}
      >
        {loading && (
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
        )}
        {children}
      </button>
    )
  },
)
Button.displayName = 'Button'

export { Button, buttonVariants }
