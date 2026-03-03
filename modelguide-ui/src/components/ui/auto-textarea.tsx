import { type ComponentProps, useCallback } from 'react'
import { cn } from '~/lib/cn'

type AutoTextareaProps = Omit<ComponentProps<'textarea'>, 'ref'>

/**
 * A textarea that auto-resizes its height to fit content.
 * Combines ref-based initial sizing with onChange-based dynamic sizing.
 */
export function AutoTextarea({ className, onChange, ...props }: AutoTextareaProps) {
  const resize = useCallback((el: HTMLTextAreaElement | null) => {
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [])

  return (
    <textarea
      ref={resize}
      onChange={(e) => {
        resize(e.target)
        onChange?.(e)
      }}
      className={cn('w-full resize-none', className)}
      {...props}
    />
  )
}
