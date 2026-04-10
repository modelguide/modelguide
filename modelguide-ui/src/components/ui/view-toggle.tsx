import { cn } from '~/lib/cn'

interface ViewToggleProps<T extends string> {
  value: T
  onChange: (value: T) => void
  options: { value: T; label: string }[]
}

export function ViewToggle<T extends string>({ value, onChange, options }: ViewToggleProps<T>) {
  return (
    <div className="inline-flex gap-1 rounded-xl bg-bg-subtle p-1">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={cn(
            'rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
            value === opt.value
              ? 'bg-bg-elevated text-fg-primary shadow-sm'
              : 'text-fg-secondary hover:text-fg-primary',
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}
