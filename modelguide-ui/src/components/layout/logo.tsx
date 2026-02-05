import { Link } from '@tanstack/react-router'
import { cn } from '~/lib/cn'

export interface LogoProps {
  className?: string
  size?: 'sm' | 'md' | 'lg'
}

const sizeClasses = {
  sm: 'text-sm',
  md: 'text-lg',
  lg: 'text-xl',
}

export function Logo({ className, size = 'md' }: LogoProps) {
  return (
    <Link
      to="/"
      className={cn(
        'group flex items-center gap-1.5 font-display font-semibold tracking-tight transition-all duration-200',
        sizeClasses[size],
        className,
      )}
    >
      <span className="text-fg-muted transition-colors group-hover:text-fg-secondary">{'{'}</span>
      <span className="text-fg-primary">model</span>
      <span className="text-fg-muted">:</span>
      <span className="text-gradient-brand transition-all duration-200 group-hover:drop-shadow-[0_0_8px_rgba(249,115,22,0.5)]">
        guide
      </span>
      <span className="text-fg-muted transition-colors group-hover:text-fg-secondary">{'}'}</span>
    </Link>
  )
}
