import { Bot } from 'lucide-react'
import { Card, CardContent } from '~/components/ui/card'
import type { UseSopFormReturn } from '../hooks/use-sop-form'
import { inlineCheckbox } from './sop-form-classes'

interface SopFormAgentsTabProps {
  form: UseSopFormReturn
}

export function SopFormAgentsTab({ form }: SopFormAgentsTabProps) {
  return (
    <Card>
      <CardContent className="pt-6">
        {!form.agentsData?.data?.length ? (
          <p className="text-xs text-fg-muted px-1.5">No agents available</p>
        ) : (
          <div className="space-y-0.5 max-h-48 overflow-y-auto">
            {form.agentsData.data.map((agent) => (
              <label
                key={agent.id}
                className="flex cursor-pointer items-center gap-2.5 rounded px-1.5 py-1.5 transition-colors hover:bg-bg-subtle/50"
              >
                <input
                  type="checkbox"
                  checked={form.selectedAgentIds.has(agent.id)}
                  onChange={() => form.toggleAgent(agent.id)}
                  className={inlineCheckbox}
                />
                <Bot className="h-3.5 w-3.5 text-fg-muted" />
                <span className="flex-1 text-sm text-fg-primary">{agent.name}</span>
                <span className="text-[10px] text-fg-muted">{agent.modality}</span>
              </label>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
