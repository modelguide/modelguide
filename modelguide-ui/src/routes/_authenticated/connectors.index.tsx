import { useQuery } from '@tanstack/react-query'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { ArrowRight, Plug, Plus } from 'lucide-react'
import { z } from 'zod'
import { Button } from '~/components/ui/button'
import { EmptyState } from '~/components/ui/empty-state'
import { PageHeader } from '~/components/ui/page-header'
import { Spinner } from '~/components/ui/spinner'
import { CatalogCard } from '~/features/connectors/components/catalog-card'
import { ConnectorsGrid } from '~/features/connectors/components/connectors-grid'
import { api } from '~/lib/api'
import { cn } from '~/lib/cn'
import type { PaginatedResponse } from '~/lib/pagination'
import type { CatalogEntry, Connector } from '~/schemas/connectors'
import { useAuthStore } from '~/stores/auth'

const searchSchema = z.object({
  tab: z.enum(['instances', 'catalog']).optional().catch(undefined),
})

export const Route = createFileRoute('/_authenticated/connectors/')({
  component: ConnectorsPage,
  validateSearch: searchSchema,
})

function ConnectorsPage() {
  const { tab } = Route.useSearch()
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const isAdmin = user?.role === 'admin'

  const activeTab = tab ?? 'instances'

  const { data: instancesData, isLoading: instancesLoading } = useQuery({
    queryKey: ['connectors'],
    queryFn: () => api.get('connectors').json<PaginatedResponse<Connector>>(),
  })

  const { data: catalogData, isLoading: catalogLoading } = useQuery({
    queryKey: ['connectors-catalog'],
    queryFn: () => api.get('connectors/catalog').json<PaginatedResponse<CatalogEntry>>(),
  })

  const instances = instancesData?.data ?? []
  const catalogEntries = catalogData?.data ?? []
  const catalogMap = new Map(catalogEntries.map((e) => [e.id, e]))
  const isLoading = instancesLoading || catalogLoading

  const setTab = (newTab: 'instances' | 'catalog') => {
    navigate({
      to: '/connectors',
      search: newTab === 'instances' ? {} : { tab: newTab },
    })
  }

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Plug}
        iconBg="bg-indigo/15"
        iconColor="text-indigo"
        title="Connectors"
        description="Configure integrations with external services"
        actions={
          isAdmin ? (
            <Link to="/connectors/new">
              <Button>
                <Plus className="h-4 w-4" />
                Add Connector
              </Button>
            </Link>
          ) : null
        }
      />

      {/* Tabs */}
      <div className="flex gap-1 rounded-xl bg-bg-subtle p-1">
        <button
          type="button"
          onClick={() => setTab('instances')}
          className={cn(
            'rounded-lg px-4 py-2 text-sm font-medium transition-colors',
            activeTab === 'instances'
              ? 'bg-bg-elevated text-fg-primary shadow-sm'
              : 'text-fg-secondary hover:text-fg-primary',
          )}
        >
          My Connectors
        </button>
        <button
          type="button"
          onClick={() => setTab('catalog')}
          className={cn(
            'rounded-lg px-4 py-2 text-sm font-medium transition-colors',
            activeTab === 'catalog'
              ? 'bg-bg-elevated text-fg-primary shadow-sm'
              : 'text-fg-secondary hover:text-fg-primary',
          )}
        >
          Catalog
        </button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Spinner size="lg" />
        </div>
      ) : activeTab === 'instances' ? (
        <InstancesTab
          instances={instances}
          catalogEntries={catalogEntries}
          catalogMap={catalogMap}
          isAdmin={isAdmin}
          onBrowseCatalog={() => setTab('catalog')}
        />
      ) : (
        <CatalogTab catalogEntries={catalogEntries} isAdmin={isAdmin} />
      )}
    </div>
  )
}

function InstancesTab({
  instances,
  catalogEntries,
  catalogMap,
  isAdmin,
  onBrowseCatalog,
}: {
  instances: Connector[]
  catalogEntries: CatalogEntry[]
  catalogMap: Map<string, CatalogEntry>
  isAdmin: boolean
  onBrowseCatalog: () => void
}) {
  // Empty state: show catalog directly
  if (instances.length === 0) {
    return (
      <div className="space-y-6">
        <EmptyState
          icon={Plug}
          title="No connectors configured yet"
          description="Get started by adding a connector from the catalog"
        />
        <CatalogGrid entries={catalogEntries} isAdmin={isAdmin} />
      </div>
    )
  }

  const previewEntries = catalogEntries.slice(0, 3)

  return (
    <div className="space-y-8">
      <ConnectorsGrid connectors={instances} catalogMap={catalogMap} isLoading={false} />

      {/* Catalog preview */}
      {previewEntries.length > 0 ? (
        <div className="space-y-4">
          <h2 className="font-display text-lg font-semibold text-fg-primary">
            Available in Catalog
          </h2>
          <CatalogGrid entries={previewEntries} dashed compact isAdmin={isAdmin} />
          <div className="flex justify-center pt-1">
            <button
              type="button"
              onClick={onBrowseCatalog}
              className="flex items-center gap-1.5 text-sm text-brand-500 hover:text-brand-400 transition-colors"
            >
              Browse full catalog
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function CatalogTab({
  catalogEntries,
  isAdmin,
}: {
  catalogEntries: CatalogEntry[]
  isAdmin: boolean
}) {
  if (catalogEntries.length === 0) {
    return (
      <EmptyState
        icon={Plug}
        title="No connectors in catalog"
        description="The connector catalog is empty"
      />
    )
  }

  return <CatalogGrid entries={catalogEntries} isAdmin={isAdmin} />
}

function CatalogGrid({
  entries,
  dashed,
  compact,
  isAdmin,
}: {
  entries: CatalogEntry[]
  dashed?: boolean
  compact?: boolean
  isAdmin: boolean
}) {
  return (
    <div className={cn('grid sm:grid-cols-2 lg:grid-cols-3', compact ? 'gap-3' : 'gap-4')}>
      {entries.map((entry, index) => (
        <CatalogCard
          key={entry.id}
          entry={entry}
          dashed={dashed}
          compact={compact}
          showAddButton={isAdmin}
          style={{ animationDelay: `${index * 50}ms` }}
        />
      ))}
    </div>
  )
}
