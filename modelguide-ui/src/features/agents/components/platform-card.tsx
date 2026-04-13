import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'
import { Select } from '~/components/ui/select'
import { api } from '~/lib/api'
import type { Agent, AgentPlatform } from '~/schemas/agents'
import { ElevenLabsFields } from './elevenlabs-fields'
import { LivekitFields } from './livekit-fields'

interface PlatformCardProps {
  agent: Agent
  isAdmin: boolean
}

export function PlatformCard({ agent, isAdmin }: PlatformCardProps) {
  const queryClient = useQueryClient()
  const [platform, setPlatform] = useState<AgentPlatform>(agent.agentPlatform)

  useEffect(() => {
    setPlatform(agent.agentPlatform)
  }, [agent.agentPlatform])

  const platformMutation = useMutation({
    mutationFn: (agentPlatform: AgentPlatform) =>
      api.patch(`agents/${agent.id}`, { json: { agentPlatform } }).json<Agent>(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents'] })
    },
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>Platform</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="max-w-xs">
          {isAdmin ? (
            <Select
              label="Platform"
              value={platform}
              onChange={(e) => {
                const val = e.target.value as AgentPlatform
                setPlatform(val)
                platformMutation.mutate(val)
              }}
              disabled={platformMutation.isPending}
            >
              <option value="custom">Custom</option>
              <option value="elevenlabs">ElevenLabs</option>
              <option value="livekit">LiveKit</option>
            </Select>
          ) : (
            <dl>
              <dt className="text-xs font-medium text-fg-muted">Platform</dt>
              <dd className="mt-1 text-sm capitalize text-fg-primary">{agent.agentPlatform}</dd>
            </dl>
          )}
        </div>
        {agent.agentPlatform === 'elevenlabs' ? (
          <ElevenLabsFields agent={agent} isAdmin={isAdmin} />
        ) : agent.agentPlatform === 'livekit' ? (
          <LivekitFields agent={agent} isAdmin={isAdmin} />
        ) : (
          <p className="text-xs text-fg-muted">
            Determines which integration URLs are shown and how sessions are initiated.
          </p>
        )}
      </CardContent>
    </Card>
  )
}
