import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { HTTPError } from 'ky'
import { ArrowLeft, Clock, Settings, Trash2, Zap } from 'lucide-react'
import { useState } from 'react'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'
import { Dialog, DialogFooter } from '~/components/ui/dialog'
import { Spinner } from '~/components/ui/spinner'
import { Toggle } from '~/components/ui/toggle'
import { DynamicConfigForm } from '~/features/connectors/components/dynamic-config-form'
import { api } from '~/lib/api'
import { useCanMutate } from '~/lib/permissions'
import type {
  CatalogEntry,
  ConfigField,
  Connector,
  ConnectorTool,
  ConnectorToolUpdate,
  ConnectorUpdate,
  HealthCheckResult,
} from '~/schemas/connectors'
import { isConnectorConfigured } from '~/schemas/connectors'
import { useAuthStore } from '~/stores/auth'

export const Route = createFileRoute('/_authenticated/connectors/$id')({
  component: ConnectorDetailPage,
})

function ConnectorDetailPage() {
  const { id } = Route.useParams()
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const isAdmin = user?.role === 'admin'
  const canMutate = useCanMutate()

  const {
    data: connector,
    isLoading: connectorLoading,
    error: connectorError,
  } = useQuery({
    queryKey: ['connectors', id],
    queryFn: () => api.get(`connectors/${id}`).json<Connector>(),
  })

  const { data: catalogEntry, isLoading: catalogLoading } = useQuery({
    queryKey: ['connectors-catalog', connector?.connectorCatalogId],
    queryFn: () =>
      api.get(`connectors/catalog/${connector?.connectorCatalogId}`).json<CatalogEntry>(),
    enabled: !!connector?.connectorCatalogId,
  })

  const { data: toolsData, isLoading: toolsLoading } = useQuery({
    queryKey: ['connectors', id, 'tools'],
    queryFn: () => api.get(`connectors/${id}/tools`).json<{ data: ConnectorTool[] }>(),
  })

  const isLoading = connectorLoading || catalogLoading || toolsLoading

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4 animate-fade-up">
        <Link
          to="/connectors"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-fg-secondary hover:bg-bg-subtle hover:text-fg-primary transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        {catalogEntry ? (
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-500/10 text-lg font-semibold text-brand-500">
            {catalogEntry.iconUrl ? (
              <img src={catalogEntry.iconUrl} alt={catalogEntry.name} className="h-6 w-6 rounded" />
            ) : (
              catalogEntry.name[0]
            )}
          </div>
        ) : null}
        <div className="flex-1">
          <h1 className="font-display text-2xl font-bold tracking-tight text-fg-primary">
            {connector?.name ?? 'Connector'}
          </h1>
          <div className="mt-0.5 flex items-center gap-2">
            {catalogEntry ? <Badge variant="default">{catalogEntry.name}</Badge> : null}
            {connector ? (
              <span className="font-mono text-xs text-fg-muted">{connector.slug}</span>
            ) : null}
          </div>
        </div>
        {connector && catalogEntry ? (
          <Badge
            variant={
              connector.isActive
                ? isConnectorConfigured(connector, catalogEntry)
                  ? 'success'
                  : 'warning'
                : 'default'
            }
            dot
          >
            {!connector.isActive
              ? 'inactive'
              : isConnectorConfigured(connector, catalogEntry)
                ? 'configured'
                : 'setup needed'}
          </Badge>
        ) : null}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Spinner size="lg" />
        </div>
      ) : connectorError ? (
        <div className="rounded-lg border border-error/30 bg-error-muted p-6 text-center">
          <p className="text-sm text-error">Failed to load connector</p>
        </div>
      ) : connector && catalogEntry ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <DetailsCard connector={connector} catalogEntry={catalogEntry} isAdmin={isAdmin} />
          {catalogEntry.hasHealthCheck ? <ConnectionStatusCard connectorId={id} /> : null}
          <ConfigurationCard
            key={connector.updatedAt}
            connector={connector}
            catalogEntry={catalogEntry}
            canMutate={canMutate}
          />
          <ToolsCard
            tools={toolsData?.data ?? []}
            catalogEntry={catalogEntry}
            connectorId={id}
            canMutate={canMutate}
          />
          {isAdmin ? (
            <DangerZoneCard
              connectorId={connector.id}
              connectorName={connector.name}
              onDeleted={() => navigate({ to: '/connectors' })}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function ConnectionStatusCard({ connectorId }: { connectorId: string }) {
  const [errorMessage, setErrorMessage] = useState<string>()

  const pingMutation = useMutation({
    mutationFn: () => api.post(`connectors/${connectorId}/ping`).json<HealthCheckResult>(),
    onMutate: () => {
      setErrorMessage(undefined)
    },
    onError: async (error) => {
      if (error instanceof HTTPError) {
        try {
          const body = (await error.response.json()) as { message?: string }
          setErrorMessage(body.message ?? 'Health check failed')
        } catch {
          setErrorMessage('Health check failed')
        }
      } else {
        setErrorMessage(error.message)
      }
    },
  })

  const result = pingMutation.data

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Zap className="h-4 w-4" />
          Connection Status
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {pingMutation.isPending ? (
            <div className="flex items-center gap-2">
              <Spinner size="sm" />
              <span className="text-sm text-fg-secondary">Testing connection...</span>
            </div>
          ) : result ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Badge variant={result.status === 'healthy' ? 'success' : 'error'} dot>
                  {result.status === 'healthy' ? 'Connected' : 'Connection failed'}
                </Badge>
                <span className="font-mono text-xs text-fg-muted">{result.latencyMs}ms</span>
              </div>
              {result.status === 'error' && result.message ? (
                <p className="text-xs text-fg-muted">{result.message}</p>
              ) : null}
              <p className="text-xs text-fg-muted">Checked just now</p>
            </div>
          ) : pingMutation.isError ? (
            <div className="space-y-2">
              <Badge variant="error" dot>
                Error
              </Badge>
              <p className="text-xs text-fg-muted">{errorMessage ?? 'Health check failed'}</p>
            </div>
          ) : (
            <p className="text-sm text-fg-muted">
              Test the connection to verify credentials and service availability.
            </p>
          )}
          <Button
            variant="secondary"
            size="sm"
            onClick={() => pingMutation.mutate()}
            disabled={pingMutation.isPending}
          >
            <Zap className="h-3.5 w-3.5" />
            Test Connection
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function DetailsCard({
  connector,
  catalogEntry,
  isAdmin,
}: {
  connector: Connector
  catalogEntry: CatalogEntry
  isAdmin: boolean
}) {
  const queryClient = useQueryClient()

  const toggleMutation = useMutation({
    mutationFn: (update: ConnectorUpdate) =>
      api.patch(`connectors/${connector.id}`, { json: update }).json<Connector>(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['connectors', connector.id] })
      queryClient.invalidateQueries({ queryKey: ['connectors'] })
    },
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>Details</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="space-y-4">
          <div>
            <dt className="text-xs font-medium text-fg-muted">Name</dt>
            <dd className="mt-1 text-sm text-fg-primary">{connector.name}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-fg-muted">Slug</dt>
            <dd className="mt-1 font-mono text-sm text-fg-secondary">{connector.slug}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-fg-muted">Type</dt>
            <dd className="mt-1 text-sm text-fg-primary capitalize">
              {catalogEntry.connectorType}
            </dd>
          </div>
          {catalogEntry.description ? (
            <div>
              <dt className="text-xs font-medium text-fg-muted">Description</dt>
              <dd className="mt-1 font-sans text-sm text-fg-secondary">
                {catalogEntry.description}
              </dd>
            </div>
          ) : null}
          <div>
            <dt className="text-xs font-medium text-fg-muted">Status</dt>
            <dd className="mt-2">
              {isAdmin ? (
                <Toggle
                  checked={connector.isActive}
                  onChange={() => toggleMutation.mutate({ isActive: !connector.isActive })}
                  disabled={toggleMutation.isPending}
                  label={connector.isActive ? 'Active' : 'Inactive'}
                />
              ) : (
                <Badge variant={connector.isActive ? 'success' : 'default'} dot>
                  {connector.isActive ? 'active' : 'inactive'}
                </Badge>
              )}
            </dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  )
}

function ConfigurationCard({
  connector,
  catalogEntry,
  canMutate,
}: {
  connector: Connector
  catalogEntry: CatalogEntry
  canMutate: boolean
}) {
  const queryClient = useQueryClient()
  const [config, setConfig] = useState<Record<string, unknown>>(
    connector.config as Record<string, unknown>,
  )

  const updateMutation = useMutation({
    mutationFn: (update: ConnectorUpdate) =>
      api.patch(`connectors/${connector.id}`, { json: update }).json<Connector>(),
    onSuccess: (updatedConnector) => {
      setConfig(updatedConnector.config as Record<string, unknown>)
      queryClient.invalidateQueries({ queryKey: ['connectors', connector.id] })
      queryClient.invalidateQueries({ queryKey: ['connectors'] })
    },
  })

  const configSchema = catalogEntry.configSchema as Record<string, ConfigField>

  return (
    <Card>
      <CardHeader>
        <CardTitle>Configuration</CardTitle>
      </CardHeader>
      <CardContent>
        <DynamicConfigForm
          configSchema={configSchema}
          values={config}
          onChange={setConfig}
          onSubmit={() => updateMutation.mutate({ config })}
          isSubmitting={updateMutation.isPending}
          successKey={updateMutation.data ? updateMutation.submittedAt : 0}
          disabled={!canMutate}
          error={
            updateMutation.isError
              ? updateMutation.error instanceof Error
                ? updateMutation.error.message
                : 'Failed to save configuration'
              : undefined
          }
        />
      </CardContent>
    </Card>
  )
}

function ToolsCard({
  tools,
  catalogEntry,
  connectorId,
  canMutate,
}: {
  tools: ConnectorTool[]
  catalogEntry: CatalogEntry
  connectorId: string
  canMutate: boolean
}) {
  const queryClient = useQueryClient()

  const updateToolMutation = useMutation({
    mutationFn: ({ toolId, update }: { toolId: string; update: ConnectorToolUpdate }) =>
      api.patch(`connectors/tools/${toolId}`, { json: update }).json<ConnectorTool>(),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['connectors', connectorId, 'tools'],
      })
    },
  })

  const catalogToolMap = new Map(catalogEntry.tools.map((t) => [t.name, t]))

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Settings className="h-4 w-4" />
          Tools ({tools.length})
        </CardTitle>
      </CardHeader>
      <CardContent>
        {tools.length === 0 ? (
          <p className="font-sans text-sm text-fg-muted">No tools available</p>
        ) : (
          <ul className="space-y-2">
            {tools.map((tool) => {
              const catalogTool = catalogToolMap.get(tool.name)
              return (
                <li
                  key={tool.id}
                  className="rounded-xl border border-fg-subtle/15 bg-bg-base p-3 transition-colors hover:border-fg-subtle/30"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-fg-primary">{tool.name}</p>
                        {catalogTool?.defaultRequiresConfirmation ? (
                          <Badge variant="warning">confirmation</Badge>
                        ) : null}
                      </div>
                      <p className="mt-0.5 font-mono text-xs text-fg-muted">{tool.slug}</p>
                      {tool.description ? (
                        <p className="mt-1 font-sans text-xs text-fg-secondary">
                          {tool.description}
                        </p>
                      ) : null}
                    </div>
                    <Toggle
                      checked={tool.isActive}
                      onChange={() =>
                        updateToolMutation.mutate({
                          toolId: tool.id,
                          update: { isActive: !tool.isActive },
                        })
                      }
                      disabled={!canMutate || updateToolMutation.isPending}
                    />
                  </div>
                  <div className="mt-2 flex items-center gap-1 text-fg-muted">
                    <Clock className="h-3 w-3" />
                    <span className="font-mono text-xs">{tool.timeoutSeconds}s timeout</span>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

function DangerZoneCard({
  connectorId,
  connectorName,
  onDeleted,
}: {
  connectorId: string
  connectorName: string
  onDeleted: () => void
}) {
  const [showConfirm, setShowConfirm] = useState(false)
  const queryClient = useQueryClient()

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`connectors/${connectorId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['connectors'] })
      onDeleted()
    },
  })

  return (
    <Card className="border-error/20">
      <CardHeader>
        <CardTitle className="text-error">Danger Zone</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-4 font-sans text-sm text-fg-secondary">
          Permanently delete this connector and all its tools. This action cannot be undone.
        </p>
        <Button variant="danger" onClick={() => setShowConfirm(true)}>
          <Trash2 className="h-4 w-4" />
          Delete Connector
        </Button>
      </CardContent>

      <Dialog
        open={showConfirm}
        onClose={() => setShowConfirm(false)}
        title="Delete Connector"
        description={`Are you sure you want to delete "${connectorName}"? This will also remove all associated tools.`}
        size="sm"
      >
        <DialogFooter>
          <Button variant="secondary" onClick={() => setShowConfirm(false)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={() => deleteMutation.mutate()}
            loading={deleteMutation.isPending}
          >
            Delete
          </Button>
        </DialogFooter>
      </Dialog>
    </Card>
  )
}
