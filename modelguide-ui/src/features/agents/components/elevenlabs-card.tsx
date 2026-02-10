import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Key } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'
import { Input } from '~/components/ui/input'
import { Select } from '~/components/ui/select'
import { api } from '~/lib/api'
import type { Agent, AgentPlatform } from '~/schemas/agents'
import { SyncDialog } from './sync-dialog'

interface ElevenLabsCardProps {
  agent: Agent
  isAdmin: boolean
}

export function ElevenLabsCard({ agent, isAdmin }: ElevenLabsCardProps) {
  const queryClient = useQueryClient()
  const meta = (agent.metadata ?? {}) as Record<string, unknown>
  const elMeta = (meta.elevenlabs ?? {}) as Record<string, unknown>

  // Form state
  const [platform, setPlatform] = useState<AgentPlatform>(agent.agentPlatform)
  const [elAgentId, setElAgentId] = useState((elMeta.agentId as string) ?? '')
  const [elApiKey, setElApiKey] = useState('')
  const [showApiKeyInput, setShowApiKeyInput] = useState(false)
  const [showSyncDialog, setShowSyncDialog] = useState(false)

  // Reset form when agent data changes
  useEffect(() => {
    setPlatform(agent.agentPlatform)
    const m = ((agent.metadata ?? {}) as Record<string, unknown>).elevenlabs as
      | Record<string, unknown>
      | undefined
    setElAgentId((m?.agentId as string) ?? '')
    setElApiKey('')
    setShowApiKeyInput(false)
  }, [agent.agentPlatform, agent.metadata])

  const isElevenLabs = platform === 'elevenlabs'
  const isDirty =
    platform !== agent.agentPlatform ||
    elAgentId !== ((elMeta.agentId as string) ?? '') ||
    elApiKey.length > 0

  const canSync = isElevenLabs && !!elMeta.agentId && agent.hasElevenLabsKey

  const saveMutation = useMutation({
    mutationFn: async () => {
      // Save API key first if provided
      if (elApiKey) {
        await api
          .put(`agents/${agent.id}/platform-key`, {
            json: { value: elApiKey },
          })
          .json()
      }

      // Save platform + agent ID
      const currentMeta = (agent.metadata ?? {}) as Record<string, unknown>
      const currentEl = (currentMeta.elevenlabs ?? {}) as Record<string, unknown>
      return api
        .patch(`agents/${agent.id}`, {
          json: {
            agentPlatform: platform,
            metadata: {
              ...currentMeta,
              elevenlabs: { ...currentEl, agentId: elAgentId || undefined },
            },
          },
        })
        .json<Agent>()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents'] })
      setElApiKey('')
      setShowApiKeyInput(false)
    },
  })

  return (
    <>
      <Card className="lg:col-span-2">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Platform</CardTitle>
            {isElevenLabs && elMeta.lastSyncedAt ? (
              <div className="text-right">
                {elMeta.agentName ? (
                  <p className="text-sm font-medium text-fg-primary">
                    {elMeta.agentName as string}
                  </p>
                ) : null}
                <p className="text-xs text-fg-muted">
                  Synced {new Date(elMeta.lastSyncedAt as string).toLocaleString()}
                </p>
              </div>
            ) : null}
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="max-w-xs">
              {isAdmin ? (
                <Select
                  label="Platform"
                  value={platform}
                  onChange={(e) => setPlatform(e.target.value as AgentPlatform)}
                >
                  <option value="custom">Custom</option>
                  <option value="elevenlabs">ElevenLabs</option>
                </Select>
              ) : (
                <dl>
                  <dt className="text-xs font-medium text-fg-muted">Platform</dt>
                  <dd className="mt-1 text-sm text-fg-primary capitalize">{agent.agentPlatform}</dd>
                </dl>
              )}
            </div>

            {isElevenLabs ? (
              <div className="space-y-4 border-t border-fg-subtle/10 pt-4">
                {/* ElevenLabs Agent ID */}
                <div className="max-w-md">
                  <Input
                    label="ElevenLabs Agent ID"
                    value={elAgentId}
                    onChange={(e) => setElAgentId(e.target.value)}
                    placeholder="e.g., agent_abc123"
                    disabled={!isAdmin}
                  />
                </div>

                {/* ElevenLabs API Key */}
                <div>
                  <dt className="text-xs font-medium text-fg-muted">ElevenLabs API Key</dt>
                  <dd className="mt-1">
                    <div className="flex items-center gap-2 rounded border border-fg-subtle/20 bg-bg-base p-3 max-w-md">
                      <Key className="h-4 w-4 text-fg-muted" />
                      <span className="flex-1 text-xs text-fg-secondary">
                        {agent.hasElevenLabsKey ? 'Configured' : 'Not configured'}
                      </span>
                      {agent.hasElevenLabsKey ? (
                        <Badge variant="success" dot>
                          active
                        </Badge>
                      ) : null}
                    </div>
                    {isAdmin ? (
                      showApiKeyInput ? (
                        <div className="mt-2 max-w-md">
                          <Input
                            type="password"
                            value={elApiKey}
                            onChange={(e) => setElApiKey(e.target.value)}
                            placeholder="sk_..."
                          />
                        </div>
                      ) : (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => setShowApiKeyInput(true)}
                          className="mt-2"
                        >
                          {agent.hasElevenLabsKey ? 'Update Key' : 'Configure Key'}
                        </Button>
                      )
                    ) : null}
                  </dd>
                </div>

                {/* Prerequisites */}
                <div className="flex items-center gap-4 text-xs text-fg-muted">
                  <span className={elMeta.agentId ? 'text-success' : ''}>
                    {elMeta.agentId ? '\u2713' : '\u2717'} Agent ID
                  </span>
                  <span className={agent.hasElevenLabsKey ? 'text-success' : ''}>
                    {agent.hasElevenLabsKey ? '\u2713' : '\u2717'} API Key
                  </span>
                </div>

                {/* Action buttons */}
                {isAdmin ? (
                  <div className="flex items-center gap-2 pt-2">
                    <Button
                      onClick={() => saveMutation.mutate()}
                      loading={saveMutation.isPending}
                      disabled={!isDirty}
                    >
                      Save
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => setShowSyncDialog(true)}
                      disabled={!canSync}
                    >
                      Sync to ElevenLabs
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : isAdmin && platform !== agent.agentPlatform ? (
              <div className="pt-2">
                <Button onClick={() => saveMutation.mutate()} loading={saveMutation.isPending}>
                  Save
                </Button>
              </div>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <SyncDialog
        agentId={agent.id}
        open={showSyncDialog}
        onClose={() => setShowSyncDialog(false)}
      />
    </>
  )
}
