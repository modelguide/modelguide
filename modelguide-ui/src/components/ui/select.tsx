import { ChevronDown } from 'lucide-react'
import { type SelectHTMLAttributes, forwardRef } from 'react'
import { cn } from '~/lib/cn'

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string
  error?: string
}

const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, children, label, error, id, ...props }, ref) => {
    const selectId = id || label?.toLowerCase().replace(/\s+/g, '-')

    return (
      <div className="w-full">
        {label ? (
          <label htmlFor={selectId} className="mb-1.5 block text-sm font-medium text-fg-secondary">
            {label}
          </label>
        ) : null}
        <div className="relative">
          <select
            id={selectId}
            className={cn(
              'flex h-10 w-full appearance-none rounded-lg border border-fg-subtle/20 bg-bg-subtle px-3 py-2 pr-10 text-sm text-fg-primary',
              'transition-colors duration-100 ease-out',
              'hover:border-fg-subtle',
              'focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500',
              'disabled:cursor-not-allowed disabled:opacity-50',
              error && 'border-error focus:border-error focus:ring-error',
              className,
            )}
            ref={ref}
            {...props}
          >
            {children}
          </select>
          <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-muted" />
        </div>
        {error ? <p className="mt-1.5 font-sans text-xs text-error">{error}</p> : null}
      </div>
    )
  },
)
Select.displayName = 'Select'

export { Select }
