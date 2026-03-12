import { useQuery } from '@tanstack/react-query'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { Plus, Shield } from 'lucide-react'
import { z } from 'zod'
import { Button } from '~/components/ui/button'
import { EmptyState } from '~/components/ui/empty-state'
import { PageHeader } from '~/components/ui/page-header'
import { Spinner } from '~/components/ui/spinner'
import { KbTable } from '~/features/knowledge-base/components/kb-table'
import { api } from '~/lib/api'
import { cn } from '~/lib/cn'
import type { PaginatedResponse } from '~/lib/pagination'
import { useIsAdmin } from '~/lib/permissions'
import type { GuardrailCategory, KnowledgeBaseSummary } from '~/schemas/knowledge-base'
import { CATEGORY_LABELS, GUARDRAIL_CATEGORIES } from '~/schemas/knowledge-base'

const searchSchema = z.object({
  isActive: z.enum(['true', 'false']).optional().catch(undefined),
  category: z.enum(['safety', 'compliance', 'brand', 'operational']).optional().catch(undefined),
})

export const Route = createFileRoute('/_authenticated/knowledge-base/')({
  component: KnowledgeBasePage,
  validateSearch: searchSchema,
})

const statusFilters: { label: string; value: string | undefined }[] = [
  { label: 'All', value: undefined },
  { label: 'Active', value: 'true' },
  { label: 'Inactive', value: 'false' },
]

function KnowledgeBasePage() {
  const { isActive, category } = Route.useSearch()
  const navigate = useNavigate()
  const isAdmin = useIsAdmin()

  const { data, isLoading } = useQuery({
    queryKey: ['knowledge-base', { isActive, category }],
    queryFn: () => {
      const params = new URLSearchParams()
      params.set('type', 'guardrail')
      params.set('pageSize', '50')
      if (isActive) params.set('isActive', isActive)
      if (category) params.set('category', category)
      return api
        .get(`knowledge-base?${params.toString()}`)
        .json<PaginatedResponse<KnowledgeBaseSummary>>()
    },
  })

  const items = data?.data ?? []

  const setStatus = (newStatus: string | undefined) => {
    navigate({
      to: '/knowledge-base',
      search: { isActive: newStatus as 'true' | 'false' | undefined, category },
    })
  }

  const setCategory = (newCategory: GuardrailCategory | undefined) => {
    navigate({
      to: '/knowledge-base',
      search: { isActive, category: newCategory },
    })
  }

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Shield}
        iconBg="bg-amber-500/15"
        iconColor="text-amber-400"
        title="Knowledge Base"
        description="Guardrails and behavioral constraints for your agents"
        actions={
          isAdmin ? (
            <Link to="/knowledge-base/new">
              <Button>
                <Plus className="h-4 w-4" />
                Add Guardrail
              </Button>
            </Link>
          ) : null
        }
      />

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-4">
        {/* Status filter */}
        <div className="flex gap-2">
          {statusFilters.map((filter) => (
            <button
              key={filter.label}
              type="button"
              onClick={() => setStatus(filter.value)}
              className={cn(
                'rounded-full px-3 py-1 text-xs font-medium transition-colors',
                isActive === filter.value
                  ? 'bg-brand-500/15 text-brand-400'
                  : 'text-fg-muted hover:text-fg-secondary hover:bg-bg-subtle',
              )}
            >
              {filter.label}
            </button>
          ))}
        </div>

        {/* Category filter */}
        <div className="flex gap-2 border-l border-fg-subtle/10 pl-4">
          <button
            type="button"
            onClick={() => setCategory(undefined)}
            className={cn(
              'rounded-full px-3 py-1 text-xs font-medium transition-colors',
              !category
                ? 'bg-brand-500/15 text-brand-400'
                : 'text-fg-muted hover:text-fg-secondary hover:bg-bg-subtle',
            )}
          >
            All Categories
          </button>
          {GUARDRAIL_CATEGORIES.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setCategory(cat)}
              className={cn(
                'rounded-full px-3 py-1 text-xs font-medium transition-colors',
                category === cat
                  ? 'bg-brand-500/15 text-brand-400'
                  : 'text-fg-muted hover:text-fg-secondary hover:bg-bg-subtle',
              )}
            >
              {CATEGORY_LABELS[cat]}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Spinner size="lg" />
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={Shield}
          title="No guardrails found"
          description={
            isActive || category
              ? 'No guardrails match the current filters'
              : 'Create your first guardrail to define behavioral constraints for your agents'
          }
          action={
            isAdmin ? (
              <Link to="/knowledge-base/new">
                <Button size="sm">
                  <Plus className="h-3.5 w-3.5" />
                  Add Guardrail
                </Button>
              </Link>
            ) : undefined
          }
        />
      ) : (
        <KbTable items={items} />
      )}
    </div>
  )
}
