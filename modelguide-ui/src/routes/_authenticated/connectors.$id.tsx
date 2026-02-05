import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import { ArrowLeft, Settings } from 'lucide-react'
import { Badge } from '~/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'
import { Spinner } from '~/components/ui/spinner'
import { ConnectorConfigForm } from '~/features/connectors/components/connector-config-form'
import { HealthCheckButton } from '~/features/connectors/components/health-check-button'
import { api } from '~/lib/api'
import type { Connector } from '~/schemas/connectors'

export const Route = createFileRoute('/_authenticated/connectors/$id')({
  component: ConnectorDetailPage,
})

function ConnectorDetailPage() {
  const { id } = Route.useParams()
  const queryClient = useQueryClient()

  const {
    data: connector,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['connectors', id],
    queryFn: () => api.get(`connectors/${id}`).json<Connector>(),
  })

  const updateMutation = useMutation({
    mutationFn: (config: Record<string, string>) =>
      api.patch(`connectors/${id}`, { json: { config } }).json<Connector>(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['connectors', id] })
      queryClient.invalidateQueries({ queryKey: ['connectors'] })
    },
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4 animate-fade-up">
        <Link
          to="/connectors"
          className="flex h-8 w-8 items-center justify-center rounded text-fg-secondary hover:bg-bg-subtle hover:text-fg-primary"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-fg-primary">{connector?.name ?? 'Connector'}</h1>
          {connector?.title ? (
            <p className="mt-1 font-sans text-sm text-fg-secondary">{connector.title}</p>
          ) : null}
        </div>
        {connector ? (
          <Badge variant={connector.is_configured ? 'success' : 'warning'} dot>
            {connector.is_configured ? 'configured' : 'setup needed'}
          </Badge>
        ) : null}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Spinner size="lg" />
        </div>
      ) : error ? (
        <div className="rounded-lg border border-error/30 bg-error-muted p-6 text-center">
          <p className="text-sm text-error">Failed to load connector</p>
        </div>
      ) : connector ? (
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Connector Info */}
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="space-y-4">
                <div>
                  <dt className="text-xs font-medium text-fg-muted">Description</dt>
                  <dd className="mt-1 font-sans text-sm text-fg-secondary">
                    {connector.description}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-fg-muted">Type</dt>
                  <dd className="mt-1 text-sm text-fg-primary capitalize">
                    {connector.connector_type}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-fg-muted">Slug</dt>
                  <dd className="mt-1 font-mono text-sm text-fg-secondary">{connector.slug}</dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          {/* Configuration */}
          <Card>
            <CardHeader>
              <CardTitle>Configuration</CardTitle>
            </CardHeader>
            <CardContent>
              <ConnectorConfigForm
                connector={connector}
                onSubmit={(config) => updateMutation.mutate(config)}
                isSubmitting={updateMutation.isPending}
              />
            </CardContent>
          </Card>

          {/* Health Check */}
          <Card>
            <CardHeader>
              <CardTitle>Connection Test</CardTitle>
            </CardHeader>
            <CardContent>
              <HealthCheckButton connectorId={connector.id} disabled={!connector.is_configured} />
              {!connector.is_configured ? (
                <p className="mt-3 font-sans text-xs text-fg-muted">
                  Configure the connector before testing the connection.
                </p>
              ) : null}
            </CardContent>
          </Card>

          {/* Tools */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Settings className="h-4 w-4" />
                Available Tools
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-3">
                {connector.tools.map((tool) => (
                  <li
                    key={tool.id}
                    className="flex items-start justify-between rounded-lg border border-fg-subtle/20 bg-bg-base p-3"
                  >
                    <div>
                      <p className="text-sm font-medium text-fg-primary">{tool.name}</p>
                      <p className="mt-0.5 font-mono text-xs text-fg-muted">{tool.slug}</p>
                      <p className="mt-1 font-sans text-xs text-fg-secondary">{tool.description}</p>
                    </div>
                    {tool.default_requires_confirmation ? (
                      <Badge variant="warning">confirmation</Badge>
                    ) : (
                      <Badge variant="success">auto</Badge>
                    )}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  )
}
