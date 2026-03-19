import { useNavigate } from '@tanstack/react-router'
import { FlaskConical } from 'lucide-react'
import { formatDate } from '~/lib/utils'
import type { EvalSuiteSummary } from '~/schemas/eval-suites'

export interface SuitesTableProps {
  suites: EvalSuiteSummary[]
  isLoading?: boolean
}

export function SuitesTable({ suites, isLoading }: SuitesTableProps) {
  const navigate = useNavigate()

  if (isLoading) {
    return (
      <div className="overflow-hidden rounded-2xl border border-fg-subtle/10 bg-bg-elevated">
        <div className="space-y-0">
          {['skel-1', 'skel-2', 'skel-3', 'skel-4', 'skel-5'].map((key, i) => (
            <div
              key={key}
              className="h-16 border-b border-fg-subtle/5 last:border-0"
              style={{ animationDelay: `${i * 50}ms` }}
            >
              <div className="flex h-full items-center gap-4 px-5">
                <div className="h-3 w-32 animate-pulse rounded bg-bg-subtle" />
                <div className="h-3 w-20 animate-pulse rounded bg-bg-subtle" />
                <div className="h-3 w-20 animate-pulse rounded bg-bg-subtle" />
                <div className="flex-1" />
                <div className="h-3 w-16 animate-pulse rounded bg-bg-subtle" />
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (suites.length === 0) {
    return (
      <div className="relative flex flex-col items-center justify-center overflow-hidden rounded-2xl border border-fg-subtle/10 bg-bg-elevated py-20">
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-brand-500/[0.03] via-transparent to-transparent" />
        <div className="relative mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-bg-subtle">
          <FlaskConical className="h-8 w-8 text-fg-muted" />
        </div>
        <p className="relative font-display text-lg font-semibold text-fg-primary">
          No eval suites yet
        </p>
        <p className="relative mt-1 text-sm text-fg-muted">
          Init your first suite from an agent + SOP pair
        </p>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-fg-subtle/15 bg-bg-elevated">
      <table className="w-full">
        <thead className="bg-bg-elevated">
          <tr className="border-b border-fg-subtle/10">
            <th className="px-4 py-3 text-left font-display text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
              Name
            </th>
            <th className="px-4 py-3 text-left font-display text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
              Agent
            </th>
            <th className="px-4 py-3 text-left font-display text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
              SOP
            </th>
            <th className="px-4 py-3 text-left font-display text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
              Created
            </th>
          </tr>
        </thead>
        <tbody>
          {suites.map((suite, index) => (
            <tr
              key={suite.id}
              className="group cursor-pointer border-b border-fg-subtle/5 transition-colors hover:bg-bg-subtle/50 animate-fade-up"
              style={{ animationDelay: `${index * 30}ms` }}
              onClick={() =>
                navigate({ to: '/evals/suites/$suiteId', params: { suiteId: suite.id } })
              }
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  navigate({ to: '/evals/suites/$suiteId', params: { suiteId: suite.id } })
                }
              }}
              tabIndex={0}
            >
              <td className="px-4 py-3">
                <div className="flex flex-col">
                  <span className="text-sm font-medium text-fg-primary group-hover:text-brand-500 transition-colors">
                    {suite.name}
                  </span>
                  {suite.description ? (
                    <span className="text-xs text-fg-muted">{suite.description}</span>
                  ) : null}
                </div>
              </td>
              <td className="px-4 py-3">
                <span className="font-mono text-xs tabular-nums text-fg-secondary">
                  {suite.agentId.slice(0, 8)}…
                </span>
              </td>
              <td className="px-4 py-3">
                {suite.sopId ? (
                  <span className="font-mono text-xs tabular-nums text-fg-secondary">
                    {suite.sopId.slice(0, 8)}…
                  </span>
                ) : (
                  <span className="text-xs text-fg-muted">Manual</span>
                )}
              </td>
              <td className="px-4 py-3">
                <span className="text-xs text-fg-muted">
                  {formatDate(suite.createdAt, { format: 'relative' })}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
