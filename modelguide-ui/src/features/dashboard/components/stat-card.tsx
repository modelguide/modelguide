import { ArrowDown, ArrowUp } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '~/lib/cn'

export interface StatCardProps {
  label: string
  value: string | number
  trend?: {
    value: number
    isPositive?: boolean
  }
  icon?: ReactNode
  pulse?: boolean
  className?: string
  accentColor?: 'brand' | 'info' | 'success' | 'purple' | 'teal' | 'pink'
}

const accentStyles = {
  brand: {
    gradient: 'from-brand-500/20 via-brand-500/5 to-transparent',
    iconBg: 'bg-brand-500/15',
    iconColor: 'text-brand-400',
    glow: 'group-hover:shadow-[0_0_30px_-5px_rgba(249,115,22,0.3)]',
    border: 'group-hover:border-brand-500/30',
  },
  info: {
    gradient: 'from-info/20 via-info/5 to-transparent',
    iconBg: 'bg-info/15',
    iconColor: 'text-info',
    glow: 'group-hover:shadow-[0_0_30px_-5px_rgba(59,130,246,0.3)]',
    border: 'group-hover:border-info/30',
  },
  success: {
    gradient: 'from-success/20 via-success/5 to-transparent',
    iconBg: 'bg-success/15',
    iconColor: 'text-success',
    glow: 'group-hover:shadow-[0_0_30px_-5px_rgba(16,185,129,0.3)]',
    border: 'group-hover:border-success/30',
  },
  purple: {
    gradient: 'from-purple/20 via-purple/5 to-transparent',
    iconBg: 'bg-purple/15',
    iconColor: 'text-purple',
    glow: 'group-hover:shadow-[0_0_30px_-5px_rgba(168,85,247,0.3)]',
    border: 'group-hover:border-purple/30',
  },
  teal: {
    gradient: 'from-teal/20 via-teal/5 to-transparent',
    iconBg: 'bg-teal/15',
    iconColor: 'text-teal',
    glow: 'group-hover:shadow-[0_0_30px_-5px_rgba(20,184,166,0.3)]',
    border: 'group-hover:border-teal/30',
  },
  pink: {
    gradient: 'from-pink/20 via-pink/5 to-transparent',
    iconBg: 'bg-pink/15',
    iconColor: 'text-pink',
    glow: 'group-hover:shadow-[0_0_30px_-5px_rgba(236,72,153,0.3)]',
    border: 'group-hover:border-pink/30',
  },
}

export function StatCard({
  label,
  value,
  trend,
  icon,
  pulse,
  className,
  accentColor = 'brand',
}: StatCardProps) {
  const accent = accentStyles[accentColor]

  return (
    <div
      className={cn(
        'group relative overflow-hidden rounded-2xl border border-fg-subtle/10 bg-bg-elevated p-5',
        'transition-all duration-300 ease-out',
        'hover:-translate-y-1',
        accent.glow,
        accent.border,
        pulse && 'animate-pulse-glow',
        className,
      )}
    >
      {/* Gradient overlay */}
      <div
        className={cn(
          'pointer-events-none absolute inset-0 bg-gradient-to-br opacity-0 transition-opacity duration-300',
          'group-hover:opacity-100',
          accent.gradient,
        )}
      />

      <div className="relative flex items-start justify-between gap-4">
        <div className="flex-1">
          <p className="font-display text-xs font-medium uppercase tracking-wider text-fg-muted">
            {label}
          </p>
          <p className="mt-3 font-display text-4xl font-bold tracking-tight text-fg-primary">
            {value}
          </p>
          {trend && (
            <div
              className={cn(
                'mt-3 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold',
                trend.isPositive ? 'bg-success/10 text-success' : 'bg-error/10 text-error',
              )}
            >
              {trend.isPositive ? (
                <ArrowUp className="h-3 w-3" />
              ) : (
                <ArrowDown className="h-3 w-3" />
              )}
              <span>{Math.abs(trend.value)}%</span>
            </div>
          )}
        </div>
        {icon && (
          <div
            className={cn(
              'flex h-12 w-12 items-center justify-center rounded-xl transition-all duration-300',
              'group-hover:scale-110',
              accent.iconBg,
            )}
          >
            <span className={cn('transition-colors duration-300', accent.iconColor)}>{icon}</span>
          </div>
        )}
      </div>
    </div>
  )
}
