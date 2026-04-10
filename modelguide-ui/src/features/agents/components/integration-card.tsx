import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, Copy, Key, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'
import { api } from '~/lib/api'
import type { Agent, RegenerateKeyResponse } from '~/schemas/agents'

interface IntegrationCardProps {
  agent: Agent
  isAdmin: boolean
  onRegenerateSuccess: (apiKey: string) => void
}

export function IntegrationCard({ agent, isAdmin, onRegenerateSuccess }: IntegrationCardProps) {
  const queryClient = useQueryClient()
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null)

  const regenerateKeyMutation = useMutation({
    mutationFn: () => api.post(`agents/${agent.id}/regenerate-key`).json<RegenerateKeyResponse>(),
    onSuccess: (data) => {
      onRegenerateSuccess(data.apiKey)
      queryClient.invalidateQueries({ queryKey: ['agents', agent.id] })
    },
  })

  function copyUrl(label: string, url: string) {
    navigator.clipboard.writeText(url)
    setCopiedUrl(label)
    setTimeout(() => setCopiedUrl(null), 2000)
  }

  const isElevenLabs = agent.agentPlatform === 'elevenlabs'
  const hasHmac = agent.hasWebhookSecret ?? false

  const urls = [
    {
      label: 'Session Init',
      url: agent.integrationUrls?.sessionInit ?? '',
      description: 'POST — create session before starting a call',
    },
    {
      label: 'MCP Endpoint',
      url: agent.integrationUrls?.mcp ?? '',
      description: 'POST — tool calls during conversation (MCP protocol)',
    },
    {
      label: 'Post-Call Webhook',
      url: agent.integrationUrls?.postCallWebhook ?? '',
      description: 'POST — transcript storage after call',
      hmac: isElevenLabs,
    },
  ]

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Integration</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-6 sm:grid-cols-3">
            {/* API Key */}
            <div>
              <p className="mb-2 text-xs font-medium text-fg-muted">API Key</p>
              <div className="flex items-center gap-2 rounded border border-fg-subtle/20 bg-bg-base p-3">
                <Key className="h-4 w-4 shrink-0 text-fg-muted" />
                <span className="flex-1 font-mono text-xs text-fg-secondary">
                  {agent.keyPrefix ? `${agent.keyPrefix}...` : 'API key configured'}
                </span>
              </div>
              {isAdmin ? (
                <Button
                  variant="secondary"
                  size="sm"
                  className="mt-2 w-full"
                  onClick={() => regenerateKeyMutation.mutate()}
                  loading={regenerateKeyMutation.isPending}
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Regenerate Key
                </Button>
              ) : null}
            </div>

            {/* Integration URLs */}
            <div className="sm:col-span-2">
              <p className="mb-2 text-xs font-medium text-fg-muted">Integration URLs</p>
              <div className="space-y-2">
                {urls.map(({ label, url, description, hmac }) => (
                  <div
                    key={label}
                    className="flex items-start gap-2 rounded border border-fg-subtle/20 bg-bg-base p-2.5"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-xs font-medium text-fg-muted">{label}</span>
                        {hmac ? (
                          <span className={`text-xs ${hasHmac ? 'text-success' : 'text-warning'}`}>
                            {hasHmac ? '• HMAC verified' : '• HMAC not set'}
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-0.5 truncate font-mono text-xs text-fg-secondary">
                        {url}
                      </div>
                      <div className="mt-0.5 text-xs text-fg-muted">{description}</div>
                    </div>
                    <button
                      type="button"
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-fg-muted hover:bg-bg-subtle hover:text-fg-primary"
                      onClick={() => copyUrl(label, url)}
                      aria-label={`Copy ${label} URL`}
                    >
                      {copiedUrl === label ? (
                        <Check className="h-3.5 w-3.5 text-success" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </>
  )
}
