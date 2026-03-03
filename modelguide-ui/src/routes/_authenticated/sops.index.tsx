import { useQuery } from '@tanstack/react-query'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { ClipboardList, Plus } from 'lucide-react'
import { z } from 'zod'
import { Button } from '~/components/ui/button'
import { EmptyState } from '~/components/ui/empty-state'
import { PageHeader } from '~/components/ui/page-header'
import { Spinner } from '~/components/ui/spinner'
import { SopsTable } from '~/features/sops/components/sops-table'
import { TemplatesGrid } from '~/features/sops/components/templates-grid'
import { api } from '~/lib/api'
import { cn } from '~/lib/cn'
import type { PaginatedResponse } from '~/lib/pagination'
import { useIsAdmin } from '~/lib/permissions'
import type { SopStatus, SopSummary, SopTemplate } from '~/schemas/sops'

const searchSchema = z.object({
  tab: z.enum(['sops', 'templates']).optional().catch(undefined),
  status: z.enum(['draft', 'active', 'archived']).optional().catch(undefined),
})

export const Route = createFileRoute('/_authenticated/sops/')({
  component: SopsPage,
  validateSearch: searchSchema,
})

const statusFilters: { label: string; value: SopStatus | undefined }[] = [
  { label: 'All', value: undefined },
  { label: 'Draft', value: 'draft' },
  { label: 'Active', value: 'active' },
  { label: 'Archived', value: 'archived' },
]

function SopsPage() {
  const { tab, status } = Route.useSearch()
  const navigate = useNavigate()
  const isAdmin = useIsAdmin()

  const activeTab = tab ?? 'sops'

  const { data: sopsData, isLoading: sopsLoading } = useQuery({
    queryKey: ['sops', { status }],
    queryFn: () => {
      const params = new URLSearchParams()
      if (status) params.set('status', status)
      params.set('pageSize', '50')
      const qs = params.toString()
      return api.get(`sops${qs ? `?${qs}` : ''}`).json<PaginatedResponse<SopSummary>>()
    },
  })

  const { data: templatesData, isLoading: templatesLoading } = useQuery({
    queryKey: ['sop-templates'],
    queryFn: () => api.get('sops/templates').json<PaginatedResponse<SopTemplate>>(),
    enabled: activeTab === 'templates',
  })

  const sops = sopsData?.data ?? []
  const templates = templatesData?.data ?? []

  const setTab = (newTab: 'sops' | 'templates') => {
    navigate({
      to: '/sops',
      search: newTab === 'sops' ? { status } : { tab: newTab },
    })
  }

  const setStatus = (newStatus: SopStatus | undefined) => {
    navigate({
      to: '/sops',
      search: { tab: tab, status: newStatus },
    })
  }

  return (
    <div className="space-y-6">
      <PageHeader
        icon={ClipboardList}
        iconBg="bg-violet-500/15"
        iconColor="text-violet-400"
        title="SOPs"
        description="Standard operating procedures for your agents"
        actions={
          isAdmin ? (
            <Link to="/sops/new">
              <Button>
                <Plus className="h-4 w-4" />
                Create SOP
              </Button>
            </Link>
          ) : null
        }
      />

      {/* Tabs */}
      <div className="flex gap-1 rounded-xl bg-bg-subtle p-1">
        <button
          type="button"
          onClick={() => setTab('sops')}
          className={cn(
            'rounded-lg px-4 py-2 text-sm font-medium transition-colors',
            activeTab === 'sops'
              ? 'bg-bg-elevated text-fg-primary shadow-sm'
              : 'text-fg-secondary hover:text-fg-primary',
          )}
        >
          My SOPs
        </button>
        <button
          type="button"
          onClick={() => setTab('templates')}
          className={cn(
            'rounded-lg px-4 py-2 text-sm font-medium transition-colors',
            activeTab === 'templates'
              ? 'bg-bg-elevated text-fg-primary shadow-sm'
              : 'text-fg-secondary hover:text-fg-primary',
          )}
        >
          Templates
        </button>
      </div>

      {activeTab === 'sops' ? (
        <SopsTab
          sops={sops}
          isLoading={sopsLoading}
          status={status}
          onStatusChange={setStatus}
          onBrowseTemplates={() => setTab('templates')}
          isAdmin={isAdmin}
        />
      ) : (
        <TemplatesTab templates={templates} isLoading={templatesLoading} isAdmin={isAdmin} />
      )}
    </div>
  )
}

function SopsTab({
  sops,
  isLoading,
  status,
  onStatusChange,
  onBrowseTemplates,
  isAdmin,
}: {
  sops: SopSummary[]
  isLoading: boolean
  status: SopStatus | undefined
  onStatusChange: (status: SopStatus | undefined) => void
  onBrowseTemplates: () => void
  isAdmin: boolean
}) {
  return (
    <div className="space-y-4">
      {/* Status filter pills */}
      <div className="flex gap-2">
        {statusFilters.map((filter) => (
          <button
            key={filter.label}
            type="button"
            onClick={() => onStatusChange(filter.value)}
            className={cn(
              'rounded-full px-3 py-1 text-xs font-medium transition-colors',
              status === filter.value
                ? 'bg-brand-500/15 text-brand-400'
                : 'text-fg-muted hover:text-fg-secondary hover:bg-bg-subtle',
            )}
          >
            {filter.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Spinner size="lg" />
        </div>
      ) : sops.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="No SOPs found"
          description={
            status
              ? `No ${status} SOPs yet`
              : 'Create your first SOP or use a template to get started'
          }
          action={
            isAdmin ? (
              <div className="flex gap-2">
                <Link to="/sops/new">
                  <Button size="sm">
                    <Plus className="h-3.5 w-3.5" />
                    Create SOP
                  </Button>
                </Link>
                <Button variant="secondary" size="sm" onClick={onBrowseTemplates}>
                  Browse Templates
                </Button>
              </div>
            ) : undefined
          }
        />
      ) : (
        <SopsTable sops={sops} />
      )}
    </div>
  )
}

function TemplatesTab({
  templates,
  isLoading,
  isAdmin,
}: {
  templates: SopTemplate[]
  isLoading: boolean
  isAdmin: boolean
}) {
  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size="lg" />
      </div>
    )
  }

  return <TemplatesGrid templates={templates} showForkButton={isAdmin} />
}
