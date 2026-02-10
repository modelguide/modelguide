import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Key } from 'lucide-react'
import { useState } from 'react'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'
import { Input } from '~/components/ui/input'
import { Select } from '~/components/ui/select'
import { api } from '~/lib/api'
import type { Agent, AgentPlatform } from '~/schemas/agents'

interface ElevenLabsCardProps {
  agent: Agent
  isAdmin: boolean
}

export function ElevenLabsCard({ agent, isAdmin }: ElevenLabsCardProps) {
  const queryClient = useQueryClient()
  const [elevenLabsApiKey, setElevenLabsApiKey] = useState('')
  const [showElevenLabsKeyInput, setShowElevenLabsKeyInput] = useState(false)
  const [editingElevenLabsAgentId, setEditingElevenLabsAgentId] = useState('')
  const [showElevenLabsAgentIdInput, setShowElevenLabsAgentIdInput] = useState(false)

  const isElevenLabs = agent.agentPlatform === 'elevenlabs'
  const elevenlabsMeta = (agent.metadata as Record<string, unknown> | undefined)?.elevenlabs as
    | { agentId?: string; lastSyncedAt?: string; mcpServerId?: string; webhookId?: string }
    | undefined
  const elevenlabsAgentId = elevenlabsMeta?.agentId

  const updateAgentMutation = useMutation({
    mutationFn: (data: { agentPlatform?: AgentPlatform; metadata?: Record<string, unknown> }) =>
      api.patch(`agents/${agent.id}`, { json: data }).json<Agent>(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents'] })
    },
  })

  const saveElevenLabsKeyMutation = useMutation({
    mutationFn: (value: string) =>
      api
        .post('secrets', {
          json: {
            name: 'ElevenLabs API Key',
            value,
            secretType: 'api_key',
            ownerType: 'agent',
            ownerId: agent.id,
          },
        })
        .json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents', agent.id] })
      setShowElevenLabsKeyInput(false)
      setElevenLabsApiKey('')
    },
  })

  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle>Platform</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="max-w-xs">
            {isAdmin ? (
              <Select
                label="Platform"
                value={agent.agentPlatform}
                onChange={(e) => {
                  const platform = e.target.value as AgentPlatform
                  updateAgentMutation.mutate({ agentPlatform: platform })
                }}
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
              <div>
                <dt className="text-xs font-medium text-fg-muted">ElevenLabs Agent ID</dt>
                <dd className="mt-1">
                  {elevenlabsAgentId && !showElevenLabsAgentIdInput ? (
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-fg-secondary">
                        {elevenlabsAgentId}
                      </span>
                      {isAdmin ? (
                        <button
                          type="button"
                          className="text-xs text-brand-500 hover:underline"
                          onClick={() => {
                            setEditingElevenLabsAgentId(elevenlabsAgentId)
                            setShowElevenLabsAgentIdInput(true)
                          }}
                        >
                          Edit
                        </button>
                      ) : null}
                    </div>
                  ) : isAdmin ? (
                    <div className="flex items-center gap-2 max-w-md">
                      <Input
                        value={editingElevenLabsAgentId}
                        onChange={(e) => setEditingElevenLabsAgentId(e.target.value)}
                        placeholder="e.g., agent_abc123"
                        className="flex-1"
                      />
                      <Button
                        size="sm"
                        disabled={!editingElevenLabsAgentId}
                        loading={updateAgentMutation.isPending}
                        onClick={() => {
                          const currentMeta = (agent.metadata ?? {}) as Record<string, unknown>
                          const currentEl = (currentMeta.elevenlabs ?? {}) as Record<
                            string,
                            unknown
                          >
                          updateAgentMutation.mutate(
                            {
                              metadata: {
                                ...currentMeta,
                                elevenlabs: { ...currentEl, agentId: editingElevenLabsAgentId },
                              },
                            },
                            {
                              onSuccess: () => {
                                setShowElevenLabsAgentIdInput(false)
                                setEditingElevenLabsAgentId('')
                              },
                            },
                          )
                        }}
                      >
                        Save
                      </Button>
                      {elevenlabsAgentId ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => {
                            setShowElevenLabsAgentIdInput(false)
                            setEditingElevenLabsAgentId('')
                          }}
                        >
                          Cancel
                        </Button>
                      ) : null}
                    </div>
                  ) : (
                    <span className="text-xs text-fg-muted">Not configured</span>
                  )}
                </dd>
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
                    showElevenLabsKeyInput ? (
                      <div className="mt-2 space-y-2 max-w-md">
                        <Input
                          type="password"
                          value={elevenLabsApiKey}
                          onChange={(e) => setElevenLabsApiKey(e.target.value)}
                          placeholder="sk_..."
                        />
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            onClick={() => saveElevenLabsKeyMutation.mutate(elevenLabsApiKey)}
                            loading={saveElevenLabsKeyMutation.isPending}
                            disabled={!elevenLabsApiKey}
                          >
                            Save
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => {
                              setShowElevenLabsKeyInput(false)
                              setElevenLabsApiKey('')
                            }}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setShowElevenLabsKeyInput(true)}
                        className="mt-2"
                      >
                        {agent.hasElevenLabsKey ? 'Update Key' : 'Configure Key'}
                      </Button>
                    )
                  ) : null}
                </dd>
              </div>

              {/* Last Synced */}
              {elevenlabsMeta?.lastSyncedAt ? (
                <div>
                  <dt className="text-xs font-medium text-fg-muted">Last Synced</dt>
                  <dd className="mt-1 text-sm text-fg-secondary">
                    {new Date(elevenlabsMeta.lastSyncedAt).toLocaleString()}
                  </dd>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}
