import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import { ArrowLeft, Check, Copy, Key, Link2, Plug, Plus, RefreshCw, ShieldCheck, Trash2, Wrench, Zap } from 'lucide-react'
import { useState } from 'react'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'
import { Dialog, DialogFooter } from '~/components/ui/dialog'
import { Spinner } from '~/components/ui/spinner'
import { Toggle } from '~/components/ui/toggle'
import { AddConnectorDialog } from '~/features/agents/components/add-connector-dialog'
import { ApiKeyModal } from '~/features/agents/components/api-key-modal'
import { ElevenLabsCard } from '~/features/agents/components/elevenlabs-card'
import { api } from '~/lib/api'
import type {
  Agent,
  AgentConnector,
  AgentConnectorTool,
  RegenerateKeyResponse,
} from '~/schemas/agents'
import { useAuthStore } from '~/stores/auth'

export const Route = createFileRoute('/_authenticated/agents/$id')({
  component: AgentDetailPage,
})

function LinkedToolsCard({
  agentId,
  connectorsData,
  connectorsError,
  isAdmin,
}: {
  agentId: string
  connectorsData: { data: AgentConnector[] } | undefined
  connectorsError: Error | null
  isAdmin: boolean
}) {
  const queryClient = useQueryClient()
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [removeTarget, setRemoveTarget] = useState<{ id: string; name: string } | null>(null)

  const removeMutation = useMutation({
    mutationFn: (connectorId: string) => api.delete(`agents/${agentId}/connectors/${connectorId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents', agentId, 'connectors'] })
      setRemoveTarget(null)
    },
  })

  const updateToolMutation = useMutation({
    mutationFn: ({
      connectorId,
      tool,
    }: {
      connectorId: string
      tool: { slug: string; isEnabled?: boolean; requiresConfirmation?: boolean }
    }) =>
      api
        .patch(`agents/${agentId}/connectors/${connectorId}`, {
          json: { tools: [tool] },
        })
        .json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents', agentId, 'connectors'] })
    },
    onError: () => {
      queryClient.invalidateQueries({ queryKey: ['agents', agentId, 'connectors'] })
    },
  })

  const assignedConnectorIds = connectorsData?.data.map((c) => c.connectorId) ?? []

  function handleToggle(
    connectorId: string,
    tool: AgentConnectorTool,
    field: 'isEnabled' | 'requiresConfirmation',
  ): void {
    updateToolMutation.mutate({
      connectorId,
      tool: { slug: tool.slug, [field]: !tool[field] },
    })
  }

  return (
    <>
      <Card className="lg:col-span-2">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Wrench className="h-4 w-4" />
              Linked Tools
            </CardTitle>
            {isAdmin ? (
              <Button variant="secondary" size="sm" onClick={() => setShowAddDialog(true)}>
                <Plus className="h-4 w-4" />
                Add Connector
              </Button>
            ) : null}
          </div>
        </CardHeader>
        <CardContent>
          {connectorsError ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <Plug className="h-8 w-8 text-error/50" />
              <p className="mt-3 text-sm text-error">Failed to load linked tools</p>
            </div>
          ) : !connectorsData?.data?.length ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <Plug className="h-8 w-8 text-fg-muted" />
              <p className="mt-3 text-sm text-fg-muted">No connectors linked to this agent</p>
            </div>
          ) : (
            <div className="space-y-5">
              {connectorsData.data.map((connector) => (
                <div key={connector.connectorId}>
                  <div className="mb-2 flex items-center gap-2">
                    <Plug className="h-3.5 w-3.5 text-fg-muted" />
                    <span className="text-sm font-medium text-fg-primary">
                      {connector.connectorName}
                    </span>
                    <span className="font-mono text-xs text-fg-muted">
                      {connector.connectorSlug}
                    </span>
                    {isAdmin ? (
                      <button
                        type="button"
                        onClick={() => {
                          removeMutation.reset()
                          setRemoveTarget({
                            id: connector.connectorId,
                            name: connector.connectorName,
                          })
                        }}
                        className="ml-auto rounded p-1 text-fg-muted transition-colors hover:bg-error/10 hover:text-error"
                        title="Remove connector"
                        aria-label={`Remove connector ${connector.connectorName}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    ) : null}
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {connector.tools.map((tool) => (
                      <div
                        key={tool.id}
                        className="flex items-center justify-between rounded-lg border border-fg-subtle/10 bg-bg-subtle/50 px-3 py-2"
                      >
                        <span className="font-mono text-xs text-fg-secondary">{tool.slug}</span>
                        {isAdmin ? (
                          <div className="flex items-center gap-4">
                            <Toggle
                              checked={tool.requiresConfirmation}
                              onChange={() =>
                                handleToggle(connector.connectorId, tool, 'requiresConfirmation')
                              }
                              disabled={updateToolMutation.isPending}
                              label="Confirm"
                            />
                            <Toggle
                              checked={tool.isEnabled}
                              onChange={() =>
                                handleToggle(connector.connectorId, tool, 'isEnabled')
                              }
                              disabled={updateToolMutation.isPending}
                              label="Enabled"
                            />
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            {tool.requiresConfirmation ? (
                              <span title="Requires confirmation">
                                <ShieldCheck className="h-3.5 w-3.5 text-warning" />
                              </span>
                            ) : null}
                            <Badge variant={tool.isEnabled ? 'success' : 'default'} dot>
                              {tool.isEnabled ? 'on' : 'off'}
                            </Badge>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
          {updateToolMutation.error ? (
            <p className="mt-3 text-xs text-error">
              Failed to update tool setting. Please try again.
            </p>
          ) : null}
        </CardContent>
      </Card>

      {isAdmin ? (
        <>
          <AddConnectorDialog
            open={showAddDialog}
            onClose={() => setShowAddDialog(false)}
            agentId={agentId}
            assignedConnectorIds={assignedConnectorIds}
          />

          <Dialog
            open={!!removeTarget}
            onClose={() => setRemoveTarget(null)}
            title="Remove Connector"
            description={`This will unlink "${removeTarget?.name}" and all its tools from this agent.`}
          >
            {removeMutation.error ? (
              <p className="mb-3 text-xs text-error">
                Failed to remove connector. Please try again.
              </p>
            ) : null}
            <DialogFooter>
              <Button variant="secondary" onClick={() => setRemoveTarget(null)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                onClick={() => removeTarget && removeMutation.mutate(removeTarget.id)}
                loading={removeMutation.isPending}
              >
                Remove
              </Button>
            </DialogFooter>
          </Dialog>
        </>
      ) : null}
    </>
  )
}

function AgentDetailPage() {
  const { id } = Route.useParams()
  const queryClient = useQueryClient()
  const user = useAuthStore((s) => s.user)
  const isAdmin = user?.role === 'admin'

  const [showRegenerateDialog, setShowRegenerateDialog] = useState(false)
  const [newApiKey, setNewApiKey] = useState<string | null>(null)
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null)

  const {
    data: agent,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['agents', id],
    queryFn: () => api.get(`agents/${id}`).json<Agent>(),
  })

  const { data: connectorsData, error: connectorsError } = useQuery({
    queryKey: ['agents', id, 'connectors'],
    queryFn: () => api.get(`agents/${id}/connectors`).json<{ data: AgentConnector[] }>(),
    enabled: !!agent,
  })

  const activateMutation = useMutation({
    mutationFn: () => api.post(`agents/${id}/activate`).json<Agent>(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['agents'] }),
  })

  const deactivateMutation = useMutation({
    mutationFn: () => api.post(`agents/${id}/deactivate`).json<Agent>(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['agents'] }),
  })

  const regenerateKeyMutation = useMutation({
    mutationFn: () => api.post(`agents/${id}/regenerate-key`).json<RegenerateKeyResponse>(),
    onSuccess: (data) => {
      setNewApiKey(data.apiKey)
      setShowRegenerateDialog(false)
      queryClient.invalidateQueries({ queryKey: ['agents', id] })
    },
  })

  const isElevenLabs = agent?.agentPlatform === 'elevenlabs'

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4 animate-fade-up">
        <Link
          to="/agents"
          className="flex h-8 w-8 items-center justify-center rounded text-fg-secondary hover:bg-bg-subtle hover:text-fg-primary"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-fg-primary">{agent?.name ?? 'Agent Detail'}</h1>
            {agent ? (
              <Badge variant={isElevenLabs ? 'brand' : 'default'}>{agent.agentPlatform}</Badge>
            ) : null}
          </div>
          {agent?.description ? (
            <p className="mt-1 font-sans text-sm text-fg-secondary">{agent.description}</p>
          ) : null}
        </div>
        {isAdmin && agent ? (
          <div className="flex items-center gap-2">
            {agent.isActive ? (
              <Button
                variant="secondary"
                onClick={() => deactivateMutation.mutate()}
                loading={deactivateMutation.isPending}
              >
                Deactivate
              </Button>
            ) : (
              <Button
                onClick={() => activateMutation.mutate()}
                loading={activateMutation.isPending}
              >
                Activate
              </Button>
            )}
          </div>
        ) : null}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Spinner size="lg" />
        </div>
      ) : error ? (
        <div className="rounded-lg border border-error/30 bg-error-muted p-6 text-center">
          <p className="text-sm text-error">Failed to load agent</p>
        </div>
      ) : agent ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="space-y-4">
                <div>
                  <dt className="text-xs font-medium text-fg-muted">Status</dt>
                  <dd className="mt-1">
                    <Badge variant={agent.isActive ? 'success' : 'default'} dot>
                      {agent.isActive ? 'active' : 'inactive'}
                    </Badge>
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-fg-muted">Type</dt>
                  <dd className="mt-1 text-sm text-fg-primary capitalize">{agent.agentType}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-fg-muted">ID</dt>
                  <dd className="mt-1 font-mono text-xs text-fg-secondary">{agent.id}</dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          {/* API Key */}
          <Card>
            <CardHeader>
              <CardTitle>API Key</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex items-center gap-2 rounded border border-fg-subtle/20 bg-bg-base p-3">
                  <Key className="h-4 w-4 text-fg-muted" />
                  <span className="flex-1 font-mono text-xs text-fg-secondary">
                    {agent.keyPrefix ? `${agent.keyPrefix}...` : 'API key configured'}
                  </span>
                </div>

                {isAdmin ? (
                  <Button
                    variant="secondary"
                    onClick={() => setShowRegenerateDialog(true)}
                    className="w-full"
                  >
                    <RefreshCw className="h-4 w-4" />
                    Regenerate Key
                  </Button>
                ) : null}
              </div>
            </CardContent>
          </Card>

          {/* Linked Tools */}
          <LinkedToolsCard
            agentId={id}
            connectorsData={connectorsData}
            connectorsError={connectorsError}
            isAdmin={isAdmin}
          />

          {/* Platform */}
          <ElevenLabsCard agent={agent} isAdmin={isAdmin} />

          {/* Integration URLs */}
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Link2 className="h-4 w-4" />
                Integration URLs
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="mb-4 text-sm text-fg-secondary">
                {isElevenLabs
                  ? 'These URLs are configured automatically during sync.'
                  : 'Configure these URLs in your agent settings.'}
              </p>
              <div className="space-y-3">
                {(() => {
                  const baseUrl = import.meta.env.VITE_PUBLIC_API_URL || 'http://localhost:3000'
                  const hasHmac = !!(agent.metadata as Record<string, unknown> | undefined)
                    ?.webhook_hmac_secret
                  const urls = [
                    {
                      label: 'Session Init',
                      url: `${baseUrl}/api/sessions`,
                      description: 'POST — create session before starting a call',
                    },
                    {
                      label: 'MCP Endpoint',
                      url: `${baseUrl}/mcp/${agent.id}`,
                      description: 'POST — tool calls during conversation (MCP protocol)',
                    },
                    {
                      label: 'Post-Call Webhook',
                      url: `${baseUrl}/webhooks/elevenlabs/${agent.id}/post-call`,
                      description: 'POST — transcript storage after call',
                      hmac: isElevenLabs,
                    },
                  ]
                  return urls.map(({ label, url, description, hmac }) => (
                    <div
                      key={label}
                      className="flex items-center gap-2 rounded border border-fg-subtle/20 bg-bg-base p-3"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium text-fg-muted">{label}</span>
                          {hmac ? (
                            <Badge variant={hasHmac ? 'success' : 'warning'} dot>
                              {hasHmac ? 'HMAC verified' : 'HMAC not configured'}
                            </Badge>
                          ) : null}
                        </div>
                        <div className="mt-0.5 truncate font-mono text-xs text-fg-secondary">
                          {url}
                        </div>
                        <div className="mt-0.5 text-xs text-fg-muted">{description}</div>
                      </div>
                      <button
                        type="button"
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded text-fg-muted hover:bg-bg-subtle hover:text-fg-primary"
                        onClick={() => {
                          navigator.clipboard.writeText(url)
                          setCopiedUrl(label)
                          setTimeout(() => setCopiedUrl(null), 2000)
                        }}
                      >
                        {copiedUrl === label ? (
                          <Check className="h-3.5 w-3.5 text-success" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </div>
                  ))
                })()}
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {/* Regenerate Key Dialog */}
      <Dialog
        open={showRegenerateDialog}
        onClose={() => setShowRegenerateDialog(false)}
        title="Regenerate API Key"
        description="This will invalidate the current key immediately. Any integrations using the old key will stop working."
      >
        <DialogFooter>
          <Button variant="secondary" onClick={() => setShowRegenerateDialog(false)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={() => regenerateKeyMutation.mutate()}
            loading={regenerateKeyMutation.isPending}
          >
            Regenerate
          </Button>
        </DialogFooter>
      </Dialog>

      {newApiKey ? (
        <ApiKeyModal
          open
          onClose={() => setNewApiKey(null)}
          apiKey={newApiKey}
          title="New API Key Generated"
        />
      ) : null}
    </div>
  )
}
