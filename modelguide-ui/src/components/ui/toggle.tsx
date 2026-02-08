import { cn } from '~/lib/cn'

interface ToggleProps {
  checked: boolean
  onChange: () => void
  disabled?: boolean
  label?: string
}

export function Toggle({ checked, onChange, disabled, label }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      disabled={disabled}
      className={cn('group flex items-center gap-2.5', disabled && 'opacity-60')}
    >
      <span
        className={cn(
          'relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors duration-200',
          checked ? 'bg-success' : 'bg-fg-subtle/40',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200',
            checked && 'translate-x-4',
          )}
        />
      </span>
      {label ? (
        <span className="text-sm text-fg-secondary group-hover:text-fg-primary transition-colors">
          {label}
        </span>
      ) : null}
    </button>
  )
}
