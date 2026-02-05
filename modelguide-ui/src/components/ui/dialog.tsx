import { X } from 'lucide-react'
import { type ReactNode, useEffect, useRef } from 'react'
import { cn } from '~/lib/cn'

export interface DialogProps {
  open: boolean
  onClose: () => void
  title?: string
  description?: string
  children: ReactNode
  className?: string
  size?: 'sm' | 'md' | 'lg'
}

const sizeClasses = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
}

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  className,
  size = 'md',
}: DialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const previouslyFocused = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return

    if (open) {
      previouslyFocused.current = document.activeElement as HTMLElement
      dialog.showModal()
    } else {
      dialog.close()
      previouslyFocused.current?.focus()
    }
  }, [open])

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }

    const handleClickOutside = (e: MouseEvent) => {
      const rect = dialog.getBoundingClientRect()
      if (
        e.clientX < rect.left ||
        e.clientX > rect.right ||
        e.clientY < rect.top ||
        e.clientY > rect.bottom
      ) {
        onClose()
      }
    }

    dialog.addEventListener('keydown', handleEscape)
    dialog.addEventListener('click', handleClickOutside)

    return () => {
      dialog.removeEventListener('keydown', handleEscape)
      dialog.removeEventListener('click', handleClickOutside)
    }
  }, [onClose])

  if (!open) return null

  return (
    <dialog
      ref={dialogRef}
      className={cn(
        'fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 m-0',
        'w-full rounded-2xl border border-fg-subtle/10 bg-bg-elevated p-0',
        'shadow-2xl shadow-black/50',
        'animate-scale-in',
        sizeClasses[size],
        className,
      )}
    >
      <div className="p-6">
        {(title || description) && (
          <div className="mb-5 flex items-start justify-between gap-4">
            <div className="flex-1">
              {title && (
                <h2 className="font-display text-lg font-semibold text-fg-primary">{title}</h2>
              )}
              {description && <p className="mt-1 text-sm text-fg-muted">{description}</p>}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 rounded-lg p-1.5 text-fg-muted transition-colors hover:bg-bg-subtle hover:text-fg-primary"
              aria-label="Close dialog"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
        {!title && !description && (
          <button
            type="button"
            onClick={onClose}
            className="absolute top-4 right-4 rounded-lg p-1.5 text-fg-muted transition-colors hover:bg-bg-subtle hover:text-fg-primary"
            aria-label="Close dialog"
          >
            <X className="h-4 w-4" />
          </button>
        )}
        <div>{children}</div>
      </div>
    </dialog>
  )
}

export interface DialogFooterProps {
  children: ReactNode
  className?: string
}

export function DialogFooter({ children, className }: DialogFooterProps) {
  return <div className={cn('flex items-center justify-end gap-3 pt-5', className)}>{children}</div>
}
