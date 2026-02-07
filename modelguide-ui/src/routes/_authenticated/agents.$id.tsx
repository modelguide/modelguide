import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import { ArrowLeft, Key, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'
import { Dialog, DialogFooter } from '~/components/ui/dialog'
import { Spinner } from '~/components/ui/spinner'
import { ApiKeyModal } from '~/features/agents/components/api-key-modal'
import { api } from '~/lib/api'
import type { Agent, RegenerateKeyResponse } from '~/schemas/agents'
import { useAuthStore } from '~/stores/auth'

export const Route = createFileRoute('/_authenticated/agents/$id')({
  component: AgentDetailPage,
})

function AgentDetailPage() {
  const { id } = Route.useParams()
  const queryClient = useQueryClient()
  const user = useAuthStore((s) => s.user)
  const isAdmin = user?.role === 'admin'

  const [showRegenerateDialog, setShowRegenerateDialog] = useState(false)
  const [newApiKey, setNewApiKey] = useState<string | null>(null)

  const {
    data: agent,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['agents', id],
    queryFn: () => api.get(`agents/${id}`).json<Agent>(),
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
          <h1 className="text-2xl font-bold text-fg-primary">{agent?.name ?? 'Agent Detail'}</h1>
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
          {/* Agent Info */}
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
                  <span className="flex-1 text-sm text-fg-secondary">API key configured</span>
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

      {/* New API Key Modal */}
      {newApiKey ? (
        <ApiKeyModal
          open={!!newApiKey}
          onClose={() => setNewApiKey(null)}
          apiKey={newApiKey}
          title="New API Key Generated"
        />
      ) : null}
    </div>
  )
}
