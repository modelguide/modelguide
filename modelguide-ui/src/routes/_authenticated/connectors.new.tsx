import { useMutation, useQuery } from '@tanstack/react-query'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { useState } from 'react'
import { z } from 'zod'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'
import { Input } from '~/components/ui/input'
import { Spinner } from '~/components/ui/spinner'
import { CatalogCard } from '~/features/connectors/components/catalog-card'
import { DynamicConfigForm } from '~/features/connectors/components/dynamic-config-form'
import { api } from '~/lib/api'
import type { PaginatedResponse } from '~/lib/pagination'
import type { CatalogEntry, ConfigField, Connector, ConnectorCreate } from '~/schemas/connectors'

const searchSchema = z.object({
  connectorCatalogId: z.string().uuid().optional().catch(undefined),
})

export const Route = createFileRoute('/_authenticated/connectors/new')({
  component: NewConnectorPage,
  validateSearch: searchSchema,
})

function NewConnectorPage() {
  const { connectorCatalogId } = Route.useSearch()
  const navigate = useNavigate()
  const [selectedCatalogId, setSelectedCatalogId] = useState<string | undefined>(connectorCatalogId)
  if (!selectedCatalogId) {
    return <CatalogPicker onSelect={(entry) => setSelectedCatalogId(entry.id)} />
  }

  return (
    <ConnectorForm
      catalogId={selectedCatalogId}
      onBack={() => setSelectedCatalogId(undefined)}
      onCreated={(connector) => navigate({ to: '/connectors/$id', params: { id: connector.id } })}
    />
  )
}

function CatalogPicker({ onSelect }: { onSelect: (entry: CatalogEntry) => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['connectors-catalog'],
    queryFn: () => api.get('connectors/catalog').json<PaginatedResponse<CatalogEntry>>(),
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4 animate-fade-up">
        <Link
          to="/connectors"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-fg-secondary hover:bg-bg-subtle hover:text-fg-primary transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-fg-primary">Add Connector</h1>
          <p className="mt-1 font-sans text-sm text-fg-secondary">
            Choose a connector from the catalog
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Spinner size="lg" />
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {(data?.data ?? []).map((entry, index) => (
            <CatalogCard
              key={entry.id}
              entry={entry}
              onSelect={onSelect}
              showAddButton={false}
              style={{ animationDelay: `${index * 50}ms` }}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function ConnectorForm({
  catalogId,
  onBack,
  onCreated,
}: {
  catalogId: string
  onBack: () => void
  onCreated: (connector: Connector) => void
}) {
  const { data: catalogEntry, isLoading } = useQuery({
    queryKey: ['connectors-catalog', catalogId],
    queryFn: () => api.get(`connectors/catalog/${catalogId}`).json<CatalogEntry>(),
  })

  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugEdited, setSlugEdited] = useState(false)
  const [config, setConfig] = useState<Record<string, unknown>>({})

  const createMutation = useMutation({
    mutationFn: (data: ConnectorCreate) => api.post('connectors', { json: data }).json<Connector>(),
    onSuccess: onCreated,
  })

  const handleNameChange = (value: string) => {
    setName(value)
    if (!slugEdited) {
      setSlug(
        value
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, ''),
      )
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    createMutation.mutate({
      connectorCatalogId: catalogId,
      name,
      slug,
      config: Object.keys(config).length > 0 ? config : undefined,
    })
  }

  if (isLoading || !catalogEntry) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size="lg" />
      </div>
    )
  }

  const configSchema = catalogEntry.configSchema as Record<string, ConfigField>

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4 animate-fade-up">
        <button
          type="button"
          onClick={onBack}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-fg-secondary hover:bg-bg-subtle hover:text-fg-primary transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-fg-primary">Add Connector</h1>
          <p className="mt-1 font-sans text-sm text-fg-secondary">
            Configure a new {catalogEntry.name} instance
          </p>
        </div>
      </div>

      <Card className="max-w-lg">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-500/10 text-lg font-semibold text-brand-500">
              {catalogEntry.iconUrl ? (
                <img
                  src={catalogEntry.iconUrl}
                  alt={catalogEntry.name}
                  className="h-6 w-6 rounded"
                />
              ) : (
                catalogEntry.name[0]
              )}
            </div>
            <div>
              <CardTitle>{catalogEntry.name}</CardTitle>
              {catalogEntry.description ? (
                <p className="mt-1 font-sans text-sm text-fg-secondary">
                  {catalogEntry.description}
                </p>
              ) : null}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              label="Name"
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder={`e.g., My ${catalogEntry.name} Store`}
              required
            />

            <Input
              label="Slug"
              value={slug}
              onChange={(e) => {
                setSlug(e.target.value)
                setSlugEdited(true)
              }}
              placeholder="e.g., my-store"
              hint="URL-friendly identifier (lowercase, hyphens, underscores)"
              required
              className="font-mono"
            />

            {Object.keys(configSchema).length > 0 ? (
              <div className="space-y-4 border-t border-fg-subtle/10 pt-4">
                <h3 className="font-display text-sm font-semibold text-fg-primary">
                  Configuration
                </h3>
                <DynamicConfigForm
                  configSchema={configSchema}
                  values={config}
                  onChange={setConfig}
                />
              </div>
            ) : null}

            {createMutation.isError ? (
              <p className="font-sans text-sm text-error">
                {createMutation.error instanceof Error
                  ? createMutation.error.message
                  : 'Failed to create connector'}
              </p>
            ) : null}

            <div className="flex gap-3 pt-2">
              <Button type="submit" loading={createMutation.isPending} disabled={!name || !slug}>
                Create Connector
              </Button>
              <Link to="/connectors">
                <Button variant="secondary" type="button">
                  Cancel
                </Button>
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
