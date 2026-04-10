import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Radio, XCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { SecretSelector } from '~/features/connectors/components/secret-selector'
import { api } from '~/lib/api'
import type { Agent } from '~/schemas/agents'

interface LivekitFieldsProps {
  agent: Agent
  isAdmin: boolean
}

export function LivekitFields({ agent, isAdmin }: LivekitFieldsProps) {
  const queryClient = useQueryClient()
  const meta = (agent.metadata ?? {}) as Record<string, unknown>
  const lkMeta = (meta.livekit ?? {}) as Record<string, unknown>
  const configuredUrl = (lkMeta.url as string) ?? ''
  const configuredAgentName = (lkMeta.agentName as string) ?? ''

  const agentSecrets = (agent as Record<string, unknown>).secrets as
    | Record<string, string>
    | undefined
  const currentKeySecretId = agentSecrets?.livekit_api_key ?? ''
  const currentSecretSecretId = agentSecrets?.livekit_api_secret ?? ''
  const isConfigured = !!configuredUrl && !!currentKeySecretId && !!currentSecretSecretId

  // Form state
  const [showForm, setShowForm] = useState(false)
  const [urlInput, setUrlInput] = useState(configuredUrl)
  const [agentNameInput, setAgentNameInput] = useState(configuredAgentName)
  const [apiKeySecretId, setApiKeySecretId] = useState(currentKeySecretId)
  const [apiSecretSecretId, setApiSecretSecretId] = useState(currentSecretSecretId)

  useEffect(() => {
    const m = ((agent.metadata ?? {}) as Record<string, unknown>).livekit as
      | Record<string, unknown>
      | undefined
    const s = (agent as Record<string, unknown>).secrets as Record<string, string> | undefined
    setUrlInput((m?.url as string) ?? '')
    setAgentNameInput((m?.agentName as string) ?? '')
    setApiKeySecretId(s?.livekit_api_key ?? '')
    setApiSecretSecretId(s?.livekit_api_secret ?? '')
  }, [agent])

  const saveMutation = useMutation({
    mutationFn: () =>
      api
        .put(`agents/${agent.id}/livekit-config`, {
          json: {
            url: urlInput,
            apiKeySecretId,
            apiSecretSecretId,
            agentName: agentNameInput,
          },
        })
        .json<{ action: string }>(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents'] })
      setShowForm(false)
    },
  })

  const pingMutation = useMutation({
    mutationFn: () => api.post(`agents/${agent.id}/livekit-ping`).json<{ ok: boolean }>(),
  })

  const canSave = urlInput.trim() && agentNameInput.trim() && apiKeySecretId && apiSecretSecretId

  return (
    <div className="space-y-4 border-t border-fg-subtle/10 pt-4">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 text-sm font-medium text-fg-primary">
          <Radio className="h-4 w-4" />
          LiveKit
        </span>
        {isConfigured ? (
          <Badge variant="success" dot>
            configured
          </Badge>
        ) : null}
      </div>

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
            placeholder="e.g. glowbox-voice-agent"
            disabled={!isAdmin}
            required
          />
          <SecretSelector
            label="LiveKit API Key"
            value={apiKeySecretId}
            onChange={setApiKeySecretId}
            scope="agent"
            disabled={!isAdmin}
          />
          <SecretSelector
            label="LiveKit API Secret"
            value={apiSecretSecretId}
            onChange={setApiSecretSecretId}
            scope="agent"
            disabled={!isAdmin}
          />

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
                Create secrets in the Secrets page, then select them here
              </p>
            </div>
          )}
          {isConfigured ? (
            <div className="space-y-2">
              <Button
                variant="secondary"
                onClick={() => {
                  pingMutation.reset()
                  pingMutation.mutate()
                }}
                loading={pingMutation.isPending}
                className="w-full"
              >
                Test Connection
              </Button>
              {pingMutation.isSuccess ? (
                <p className="flex items-center gap-1.5 text-xs text-success">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Connection successful
                </p>
              ) : null}
              {pingMutation.isError ? (
                <p className="flex items-center gap-1.5 text-xs text-error">
                  <XCircle className="h-3.5 w-3.5" />
                  Connection failed — check URL and credentials
                </p>
              ) : null}
            </div>
          ) : null}
          {isAdmin ? (
            <Button variant="secondary" onClick={() => setShowForm(true)} className="w-full">
              {isConfigured ? 'Update Config' : 'Configure LiveKit'}
            </Button>
          ) : null}
        </div>
      )}
    </div>
  )
}
