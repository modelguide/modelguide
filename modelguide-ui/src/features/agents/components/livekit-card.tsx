import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Key, Radio } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'
import { Input } from '~/components/ui/input'
import { api } from '~/lib/api'
import type { Agent } from '~/schemas/agents'

interface LivekitCardProps {
  agent: Agent
  isAdmin: boolean
}

export function LivekitCard({ agent, isAdmin }: LivekitCardProps) {
  const queryClient = useQueryClient()
  const meta = (agent.metadata ?? {}) as Record<string, unknown>
  const lkMeta = (meta.livekit ?? {}) as Record<string, unknown>
  const configuredUrl = (lkMeta.url as string) ?? ''
  const configuredAgentName = (lkMeta.agentName as string) ?? ''

  const secrets = (agent as Record<string, unknown>).secrets as Record<string, string> | undefined
  const hasLivekitKey = !!secrets?.livekit_api_key
  const hasLivekitSecret = !!secrets?.livekit_api_secret
  const isConfigured = !!configuredUrl && hasLivekitKey && hasLivekitSecret

  // Form state
  const [showForm, setShowForm] = useState(false)
  const [urlInput, setUrlInput] = useState(configuredUrl)
  const [agentNameInput, setAgentNameInput] = useState(configuredAgentName)
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [apiSecretInput, setApiSecretInput] = useState('')

  // Reset form when agent data changes
  useEffect(() => {
    const m = ((agent.metadata ?? {}) as Record<string, unknown>).livekit as
      | Record<string, unknown>
      | undefined
    setUrlInput((m?.url as string) ?? '')
    setAgentNameInput((m?.agentName as string) ?? '')
    setApiKeyInput('')
    setApiSecretInput('')
  }, [agent.metadata])

  const saveMutation = useMutation({
    mutationFn: () =>
      api
        .put(`agents/${agent.id}/livekit-config`, {
          json: {
            url: urlInput,
            apiKey: apiKeyInput,
            apiSecret: apiSecretInput,
            agentName: agentNameInput || undefined,
          },
        })
        .json<{ action: string }>(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents'] })
      setApiKeyInput('')
      setApiSecretInput('')
      setShowForm(false)
    },
  })

  const canSave = urlInput.trim() && apiKeyInput.trim() && apiSecretInput.trim()

  if (agent.modality !== 'voice' || agent.agentPlatform !== 'custom') return null

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Radio className="h-4 w-4" />
            LiveKit
          </CardTitle>
          {isConfigured ? (
            <Badge variant="success" dot>
              configured
            </Badge>
          ) : null}
        </div>
      </CardHeader>
      <CardContent>
        {showForm ? (
          <div className="space-y-4">
            <Input
              label="LiveKit URL"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="wss://your-project.livekit.cloud"
              disabled={!isAdmin}
              required
            />
            <Input
              label="Agent Name"
              value={agentNameInput}
              onChange={(e) => setAgentNameInput(e.target.value)}
              placeholder={agent.slug}
              hint={`Defaults to agent slug: ${agent.slug}`}
              disabled={!isAdmin}
            />
            <div>
              <dt className="flex items-center gap-1.5 text-xs font-medium text-fg-muted">
                LiveKit API Key
              </dt>
              <dd className="mt-1">
                <div className="flex items-center gap-2 rounded border border-fg-subtle/20 bg-bg-base p-3">
                  <Key className="h-4 w-4 text-fg-muted" />
                  <span className="flex-1 text-xs text-fg-secondary">
                    {hasLivekitKey ? 'Configured' : 'Not configured'}
                  </span>
                  {hasLivekitKey ? (
                    <Badge variant="success" dot>
                      active
                    </Badge>
                  ) : null}
                </div>
                <div className="mt-2">
                  <Input
                    type="password"
                    value={apiKeyInput}
                    onChange={(e) => setApiKeyInput(e.target.value)}
                    placeholder="API..."
                    disabled={!isAdmin}
                    required
                  />
                </div>
              </dd>
            </div>
            <div>
              <dt className="flex items-center gap-1.5 text-xs font-medium text-fg-muted">
                LiveKit API Secret
              </dt>
              <dd className="mt-1">
                <div className="flex items-center gap-2 rounded border border-fg-subtle/20 bg-bg-base p-3">
                  <Key className="h-4 w-4 text-fg-muted" />
                  <span className="flex-1 text-xs text-fg-secondary">
                    {hasLivekitSecret ? 'Configured' : 'Not configured'}
                  </span>
                  {hasLivekitSecret ? (
                    <Badge variant="success" dot>
                      active
                    </Badge>
                  ) : null}
                </div>
                <div className="mt-2">
                  <Input
                    type="password"
                    value={apiSecretInput}
                    onChange={(e) => setApiSecretInput(e.target.value)}
                    placeholder="Secret..."
                    disabled={!isAdmin}
                    required
                  />
                </div>
              </dd>
            </div>

            {/* Prerequisites */}
            <div className="flex items-center gap-4 text-xs text-fg-muted">
              <span className={configuredUrl ? 'text-success' : ''}>
                {configuredUrl ? '\u2713' : '\u2717'} URL
              </span>
              <span className={hasLivekitKey ? 'text-success' : ''}>
                {hasLivekitKey ? '\u2713' : '\u2717'} API Key
              </span>
              <span className={hasLivekitSecret ? 'text-success' : ''}>
                {hasLivekitSecret ? '\u2713' : '\u2717'} API Secret
              </span>
            </div>

            {isAdmin ? (
              <div className="flex items-center gap-2 pt-2">
                <Button
                  onClick={() => saveMutation.mutate()}
                  loading={saveMutation.isPending}
                  disabled={!canSave}
                >
                  Save
                </Button>
                <Button variant="secondary" onClick={() => setShowForm(false)}>
                  Cancel
                </Button>
              </div>
            ) : null}

            {saveMutation.error ? (
              <p className="text-xs text-error">Failed to save LiveKit config. Please try again.</p>
            ) : null}
          </div>
        ) : (
          <div className="space-y-4">
            {isConfigured ? (
              <dl className="space-y-3">
                <div>
                  <dt className="text-xs font-medium text-fg-muted">URL</dt>
                  <dd className="mt-1 truncate font-mono text-xs text-fg-secondary">
                    {configuredUrl}
                  </dd>
                </div>
                {configuredAgentName ? (
                  <div>
                    <dt className="text-xs font-medium text-fg-muted">Agent Name</dt>
                    <dd className="mt-1 font-mono text-xs text-fg-secondary">
                      {configuredAgentName}
                    </dd>
                  </div>
                ) : null}
              </dl>
            ) : (
              <div className="flex flex-col items-center justify-center py-6 text-center">
                <Radio className="h-8 w-8 text-fg-muted" />
                <p className="mt-3 text-sm text-fg-muted">LiveKit not configured</p>
                <p className="mt-1 text-xs text-fg-muted">
                  Required for outbound calls from the dashboard
                </p>
              </div>
            )}
            {isAdmin ? (
              <Button variant="secondary" onClick={() => setShowForm(true)} className="w-full">
                {isConfigured ? 'Update Config' : 'Configure LiveKit'}
              </Button>
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
