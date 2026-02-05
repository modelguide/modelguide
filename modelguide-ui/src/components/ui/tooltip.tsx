import { type ReactNode, useState } from 'react'
import { cn } from '~/lib/cn'

export interface TooltipProps {
  content: ReactNode
  children: ReactNode
  side?: 'top' | 'bottom' | 'left' | 'right'
  align?: 'start' | 'center' | 'end'
  className?: string
  delayMs?: number
}

export function Tooltip({
  content,
  children,
  side = 'top',
  align = 'center',
  className,
  delayMs = 200,
}: TooltipProps) {
  const [isVisible, setIsVisible] = useState(false)
  const [timeoutId, setTimeoutId] = useState<ReturnType<typeof setTimeout> | null>(null)

  const handleMouseEnter = () => {
    const id = setTimeout(() => setIsVisible(true), delayMs)
    setTimeoutId(id)
  }

  const handleMouseLeave = () => {
    if (timeoutId) {
      clearTimeout(timeoutId)
      setTimeoutId(null)
    }
    setIsVisible(false)
  }

  const positionClasses = {
    top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
    left: 'right-full top-1/2 -translate-y-1/2 mr-2',
    right: 'left-full top-1/2 -translate-y-1/2 ml-2',
  }

  const alignClasses = {
    start: side === 'top' || side === 'bottom' ? 'left-0 translate-x-0' : 'top-0 translate-y-0',
    center: '',
    end:
      side === 'top' || side === 'bottom'
        ? 'right-0 left-auto translate-x-0'
        : 'bottom-0 top-auto translate-y-0',
  }

  const arrowClasses = {
    top: 'top-full left-1/2 -translate-x-1/2 border-t-bg-elevated border-x-transparent border-b-transparent',
    bottom:
      'bottom-full left-1/2 -translate-x-1/2 border-b-bg-elevated border-x-transparent border-t-transparent',
    left: 'left-full top-1/2 -translate-y-1/2 border-l-bg-elevated border-y-transparent border-r-transparent',
    right:
      'right-full top-1/2 -translate-y-1/2 border-r-bg-elevated border-y-transparent border-l-transparent',
  }

  return (
    <div
      className="relative inline-flex"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {children}
      {isVisible && (
        <div
          role="tooltip"
          className={cn(
            'absolute z-50 whitespace-nowrap rounded-lg border border-fg-subtle/10 bg-bg-elevated px-3 py-1.5 text-xs text-fg-primary shadow-lg',
            'animate-in fade-in-0 zoom-in-95 duration-100',
            positionClasses[side],
            align !== 'center' && alignClasses[align],
            className,
          )}
        >
          {content}
          <div
            className={cn('absolute h-0 w-0 border-4', arrowClasses[side])}
            style={{ borderWidth: '5px' }}
          />
        </div>
      )}
    </div>
  )
}
