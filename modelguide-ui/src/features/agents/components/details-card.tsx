import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'
import { Select } from '~/components/ui/select'
import { api } from '~/lib/api'
import { type Agent, type ModelFamily, modelFamilies } from '~/schemas/agents'

const MODEL_FAMILY_LABELS: Record<ModelFamily, string> = {
  gpt: 'GPT',
  claude: 'Claude',
  gemini: 'Gemini',
  generic: 'Generic',
}

interface DetailsCardProps {
  agent: Agent
  isAdmin: boolean
}

export function DetailsCard({ agent, isAdmin }: DetailsCardProps) {
  const queryClient = useQueryClient()

  const modelFamilyMutation = useMutation({
    mutationFn: (modelFamily: ModelFamily) =>
      api.patch(`agents/${agent.id}`, { json: { modelFamily } }).json<Agent>(),
    onSuccess: (updated) => {
      queryClient.setQueryData(['agents', agent.id], updated)
    },
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>Details</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="space-y-4">
          <div>
            <dt className="text-xs font-medium text-fg-muted">Modality</dt>
            <dd className="mt-1 text-sm capitalize text-fg-primary">{agent.modality}</dd>
          </div>
          <div>
            <dt className="mb-1.5 text-xs font-medium text-fg-muted">Model family</dt>
            <dd>
              {isAdmin ? (
                <Select
                  value={agent.modelFamily}
                  onChange={(e) => modelFamilyMutation.mutate(e.target.value as ModelFamily)}
                  disabled={modelFamilyMutation.isPending}
                >
                  {modelFamilies.map((f) => (
                    <option key={f} value={f}>
                      {MODEL_FAMILY_LABELS[f]}
                    </option>
                  ))}
                </Select>
              ) : (
                <span className="text-sm text-fg-primary">
                  {MODEL_FAMILY_LABELS[agent.modelFamily]}
                </span>
              )}
            </dd>
          </div>
          {agent.description ? (
            <div>
              <dt className="text-xs font-medium text-fg-muted">Description</dt>
              <dd className="mt-1 text-sm text-fg-secondary">{agent.description}</dd>
            </div>
          ) : null}
        </dl>
      </CardContent>
    </Card>
  )
}
