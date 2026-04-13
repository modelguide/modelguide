import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import {
  ArrowLeft,
  ChevronRight,
  FlaskConical,
  Phone,
  Plug,
  Plus,
  ShieldCheck,
  Trash2,
  Wrench,
} from 'lucide-react'
import { useState } from 'react'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'
import { Dialog, DialogFooter } from '~/components/ui/dialog'
import { Spinner } from '~/components/ui/spinner'
import { Toggle } from '~/components/ui/toggle'
import { AddConnectorDialog } from '~/features/agents/components/add-connector-dialog'
import { ApiKeyModal } from '~/features/agents/components/api-key-modal'
import { DetailsCard } from '~/features/agents/components/details-card'
import { IntegrationCard } from '~/features/agents/components/integration-card'
import { OutboundCallDialog } from '~/features/agents/components/outbound-call-dialog'
import { PlatformCard } from '~/features/agents/components/platform-card'
import { PromptSection } from '~/features/agents/components/prompt-section'
import { api } from '~/lib/api'
import type { Agent, AgentConnector, AgentConnectorTool } from '~/schemas/agents'
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
      <Card>
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
                    {connector.connectorIconUrl ? (
                      <img
                        src={connector.connectorIconUrl}
                        alt=""
                        className="h-3.5 w-3.5 rounded-sm object-contain"
                      />
                    ) : (
                      <Plug className="h-3.5 w-3.5 text-fg-muted" />
                    )}
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

  const [newApiKey, setNewApiKey] = useState<string | null>(null)

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

  return (
    <div className="space-y-6">
      {/* Page header */}
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
              <Badge variant={agent.isActive ? 'success' : 'default'} dot>
                {agent.isActive ? 'active' : 'inactive'}
              </Badge>
            ) : null}
          </div>
          <p className="mt-1 font-mono text-xs text-fg-muted">{id}</p>
        </div>
        {isAdmin && agent ? (
          <div className="flex items-center gap-2">
            {agent.isActive && agent.modality === 'voice' && agent.agentPlatform === 'livekit' ? (
              <OutboundCallDialog
                agentId={agent.id}
                trigger={
                  <Button variant="secondary">
                    <Phone className="h-4 w-4" />
                    Make Call
                  </Button>
                }
              />
            ) : null}
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
        <div className="space-y-6">
          {/* Row 1: Details + Platform (2-col grid) */}
          <div className="grid gap-6 lg:grid-cols-3">
            <DetailsCard agent={agent} isAdmin={isAdmin} />
            <div className="lg:col-span-2">
              <PlatformCard agent={agent} isAdmin={isAdmin} />
            </div>
          </div>

          {/* Row 2: Eval Suites */}
          <Link
            to="/evals"
            search={{ agentId: id }}
            className="flex items-center gap-3 rounded-lg border border-fg-subtle/10 bg-bg-subtle px-4 py-3 transition-colors hover:border-brand-500/30 hover:bg-bg-subtle/80"
          >
            <FlaskConical className="h-4 w-4 shrink-0 text-cyan-400" />
            <span className="flex-1 text-sm font-medium text-fg-primary">Eval Suites</span>
            <Badge variant="default">{agent.evalSuiteCount}</Badge>
            <ChevronRight className="h-4 w-4 shrink-0 text-fg-muted" />
          </Link>

          {/* Row 3: Integration (full width) */}
          <IntegrationCard agent={agent} isAdmin={isAdmin} onRegenerateSuccess={setNewApiKey} />

          {/* Row 3: Prompt section (full width, tabbed) */}
          <PromptSection agent={agent} canMutate={isAdmin} />

          {/* Row 4: Linked Tools (full width) */}
          <LinkedToolsCard
            agentId={id}
            connectorsData={connectorsData}
            connectorsError={connectorsError}
            isAdmin={isAdmin}
          />
        </div>
      ) : null}

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
