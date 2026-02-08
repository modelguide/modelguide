import { type InputHTMLAttributes, type ReactNode, forwardRef } from 'react'
import { cn } from '~/lib/cn'

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  hint?: string
  leftIcon?: ReactNode
  rightIcon?: ReactNode
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, label, error, hint, leftIcon, rightIcon, id, ...props }, ref) => {
    const inputId = id || label?.toLowerCase().replace(/\s+/g, '-')

    return (
      <div className="w-full">
        {label ? (
          <label htmlFor={inputId} className="mb-1.5 block text-sm font-medium text-fg-secondary">
            {label}
            {props.required ? <span className="ml-0.5 text-error">*</span> : null}
          </label>
        ) : null}
        <div className="relative">
          {leftIcon ? (
            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-fg-muted">
              {leftIcon}
            </div>
          ) : null}
          <input
            type={type}
            id={inputId}
            className={cn(
              'flex h-10 w-full rounded-lg border border-fg-subtle/20 bg-bg-subtle px-3 py-2 text-sm text-fg-primary placeholder:text-fg-muted',
              'transition-colors duration-100 ease-out',
              'hover:border-fg-subtle',
              'focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500',
              'disabled:cursor-not-allowed disabled:opacity-50',
              error && 'border-error focus:border-error focus:ring-error',
              leftIcon && 'pl-10',
              rightIcon && 'pr-10',
              className,
            )}
            ref={ref}
            {...props}
          />
          {rightIcon ? (
            <div className="absolute inset-y-0 right-0 flex items-center pr-3 text-fg-muted">
              {rightIcon}
            </div>
          ) : null}
        </div>
        {error ? (
          <p className="mt-1.5 font-sans text-xs text-error">{error}</p>
        ) : hint ? (
          <p className="mt-1.5 font-sans text-xs text-fg-muted">{hint}</p>
        ) : null}
      </div>
    )
  },
)
Input.displayName = 'Input'

export { Input }
