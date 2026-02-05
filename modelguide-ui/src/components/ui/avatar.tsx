import { type ImgHTMLAttributes, forwardRef } from 'react'
import { cn } from '~/lib/cn'
import { getInitials } from '~/lib/utils'

export interface AvatarProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> {
  src?: string | null
  name: string
  size?: 'sm' | 'md' | 'lg'
}

const sizeClasses = {
  sm: 'h-6 w-6 text-[10px]',
  md: 'h-8 w-8 text-xs',
  lg: 'h-10 w-10 text-sm',
}

const Avatar = forwardRef<HTMLDivElement, AvatarProps>(
  ({ className, src, name, size = 'md', alt, ...props }, ref) => {
    const initials = getInitials(name)

    if (src) {
      return (
        <div
          ref={ref}
          className={cn(
            'relative flex shrink-0 overflow-hidden rounded-full',
            sizeClasses[size],
            className,
          )}
        >
          {/* biome-ignore lint/a11y/useAltText: alt is provided dynamically via alt || name */}
          <img src={src} alt={alt || name} className="h-full w-full object-cover" {...props} />
        </div>
      )
    }

    return (
      <div
        ref={ref}
        className={cn(
          'flex shrink-0 items-center justify-center rounded-full bg-bg-subtle font-mono font-medium text-fg-secondary',
          sizeClasses[size],
          className,
        )}
      >
        {initials}
      </div>
    )
  },
)
Avatar.displayName = 'Avatar'

export { Avatar }
