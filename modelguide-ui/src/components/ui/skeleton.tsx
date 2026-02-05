import { cn } from '~/lib/cn'

interface SkeletonProps {
  className?: string
}

export function Skeleton({ className }: SkeletonProps) {
  return <div className={cn('animate-pulse rounded bg-fg-subtle/20', className)} />
}

export function SkeletonText({ className }: SkeletonProps) {
  return <Skeleton className={cn('h-4 w-full', className)} />
}

export function SkeletonCard({ className }: SkeletonProps) {
  return (
    <div
      className={cn(
        'rounded-lg border border-fg-subtle/20 bg-bg-elevated p-4 space-y-3',
        className,
      )}
    >
      <Skeleton className="h-4 w-1/3" />
      <Skeleton className="h-8 w-2/3" />
      <Skeleton className="h-3 w-1/2" />
    </div>
  )
}

export function SkeletonTable({ rows = 5, columns = 4 }: { rows?: number; columns?: number }) {
  return (
    <div className="overflow-hidden rounded-lg border border-fg-subtle/20 bg-bg-elevated">
      <div className="border-b border-fg-subtle/20 bg-bg-subtle/50 px-4 py-3">
        <div className="flex gap-4">
          {Array.from({ length: columns }, (_, i) => `header-${i}`).map((key) => (
            <Skeleton key={key} className="h-3 w-20" />
          ))}
        </div>
      </div>
      <div className="divide-y divide-fg-subtle/10">
        {Array.from({ length: rows }, (_, i) => `row-${i}`).map((rowKey) => (
          <div key={rowKey} className="flex gap-4 px-4 py-3">
            {Array.from({ length: columns }, (_, j) => `cell-${rowKey}-${j}`).map((cellKey) => (
              <Skeleton key={cellKey} className="h-4 w-24" />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
