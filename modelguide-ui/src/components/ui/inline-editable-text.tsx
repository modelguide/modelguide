import { Check, Pencil, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { cn } from '~/lib/cn'

interface InlineEditableTextProps {
  value: string
  onSave: (value: string) => void
  disabled?: boolean
  className?: string
  inputClassName?: string
}

export function InlineEditableText({
  value,
  onSave,
  disabled = false,
  className,
  inputClassName,
}: InlineEditableTextProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [editing])

  function startEditing() {
    if (disabled) return
    setDraft(value)
    setEditing(true)
  }

  function save() {
    const trimmed = draft.trim()
    if (trimmed && trimmed !== value) {
      onSave(trimmed)
    }
    setEditing(false)
  }

  function cancel() {
    setDraft(value)
    setEditing(false)
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') save()
    if (e.key === 'Escape') cancel()
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <input
          ref={inputRef}
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={save}
          className={cn(
            'rounded border border-brand-500/30 bg-bg-subtle px-2 py-0.5 text-fg-primary outline-none focus:border-brand-500',
            inputClassName,
          )}
        />
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={save}
          className="rounded p-0.5 text-success hover:bg-success/10"
        >
          <Check className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={cancel}
          className="rounded p-0.5 text-fg-muted hover:bg-bg-subtle"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={startEditing}
      disabled={disabled}
      className={cn(
        'group/edit inline-flex items-center gap-1.5 rounded-md px-1 -ml-1 transition-colors',
        !disabled && 'hover:bg-bg-subtle/50 cursor-pointer',
        className,
      )}
    >
      <span className="truncate">{value}</span>
      {!disabled ? (
        <Pencil className="h-3 w-3 shrink-0 text-fg-muted opacity-0 transition-opacity group-hover/edit:opacity-100" />
      ) : null}
    </button>
  )
}
