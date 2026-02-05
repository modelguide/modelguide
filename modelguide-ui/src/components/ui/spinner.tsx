import { cn } from '~/lib/cn'

export interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

const sizeClasses = {
  sm: 'h-4 w-4 border-2',
  md: 'h-6 w-6 border-2',
  lg: 'h-8 w-8 border-3',
}

export function Spinner({ size = 'md', className }: SpinnerProps) {
  return (
    <output
      className={cn(
        'inline-block animate-spin rounded-full border-brand-500 border-t-transparent',
        sizeClasses[size],
        className,
      )}
      aria-label="Loading"
    >
      <span className="sr-only">Loading...</span>
    </output>
  )
}
