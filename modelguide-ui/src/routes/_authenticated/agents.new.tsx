import { useMutation } from '@tanstack/react-query'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { useState } from 'react'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'
import { Input } from '~/components/ui/input'
import { Select } from '~/components/ui/select'
import { ApiKeyModal } from '~/features/agents/components/api-key-modal'
import { api } from '~/lib/api'
import type { AgentCreate, AgentPlatform, AgentWithKey } from '~/schemas/agents'

/** Helper to build metadata with elevenlabs namespace */
function buildElevenlabsMetadata(agentId: string) {
  return { elevenlabs: { agentId } }
}

export const Route = createFileRoute('/_authenticated/agents/new')({
  component: NewAgentPage,
})

function NewAgentPage() {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [agentType, setAgentType] = useState<'voice'>('voice')
  const [agentPlatform, setAgentPlatform] = useState<AgentPlatform>('custom')
  const [elevenlabsAgentId, setElevenlabsAgentId] = useState('')
  const [newAgent, setNewAgent] = useState<AgentWithKey | null>(null)

  const createMutation = useMutation({
    mutationFn: (data: AgentCreate) => api.post('agents', { json: data }).json<AgentWithKey>(),
    onSuccess: (data) => {
      setNewAgent(data)
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    createMutation.mutate({
      name,
      description: description || undefined,
      agentType,
      agentPlatform,
      metadata:
        agentPlatform === 'elevenlabs' && elevenlabsAgentId
          ? buildElevenlabsMetadata(elevenlabsAgentId)
          : undefined,
    })
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4 animate-fade-up">
        <Link
          to="/agents"
          className="flex h-8 w-8 items-center justify-center rounded text-fg-secondary hover:bg-bg-subtle hover:text-fg-primary"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-fg-primary">Create Agent</h1>
          <p className="mt-1 font-sans text-sm text-fg-secondary">Configure a new AI agent</p>
        </div>
      </div>

      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle>Agent Details</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              label="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Pizza Palace Assistant"
              required
            />

            <label className="block w-full">
              <span className="mb-1.5 block text-sm font-medium text-fg-secondary">
                Description
              </span>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe what this agent does..."
                className="flex min-h-[80px] w-full rounded-lg border border-fg-subtle/20 bg-bg-subtle px-3 py-2 text-sm text-fg-primary placeholder:text-fg-muted transition-colors hover:border-fg-subtle focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                rows={3}
              />
            </label>

            <Select
              label="Agent Type"
              value={agentType}
              onChange={(e) => setAgentType(e.target.value as 'voice')}
            >
              <option value="voice">Voice</option>
            </Select>

            <Select
              label="Platform"
              value={agentPlatform}
              onChange={(e) => setAgentPlatform(e.target.value as AgentPlatform)}
            >
              <option value="custom">Custom</option>
              <option value="elevenlabs">ElevenLabs</option>
            </Select>

            {agentPlatform === 'elevenlabs' ? (
              <Input
                label="ElevenLabs Agent ID"
                value={elevenlabsAgentId}
                onChange={(e) => setElevenlabsAgentId(e.target.value)}
                placeholder="e.g., abc123def456"
                required
              />
            ) : null}

            <div className="flex gap-3 pt-2">
              <Button type="submit" loading={createMutation.isPending}>
                Create Agent
              </Button>
              <Link to="/agents">
                <Button variant="secondary" type="button">
                  Cancel
                </Button>
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>

      {newAgent ? (
        <ApiKeyModal
          open={!!newAgent}
          onClose={() => navigate({ to: '/agents/$id', params: { id: newAgent.id } })}
          apiKey={newAgent.apiKey}
          title="Agent Created Successfully"
        />
      ) : null}
    </div>
  )
}
