import { useQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { Input } from '~/components/ui/input'
import { Select } from '~/components/ui/select'
import { api } from '~/lib/api'
import type { AgentListResponse } from '~/schemas/agents'
import type { ChannelType, SessionStatus } from '~/schemas/sessions'

export interface SessionFilters {
  status?: SessionStatus
  channel_type?: ChannelType
  agent_id?: string
  search?: string
}

export interface SessionsFiltersProps {
  filters: SessionFilters
  onFiltersChange: (filters: SessionFilters) => void
}

const statusOptions: Array<{ value: SessionStatus | ''; label: string }> = [
  { value: '', label: 'All Status' },
  { value: 'active', label: 'Active' },
  { value: 'completed', label: 'Completed' },
  { value: 'escalated', label: 'Escalated' },
  { value: 'abandoned', label: 'Abandoned' },
]

const channelOptions: Array<{ value: ChannelType | ''; label: string }> = [
  { value: '', label: 'All Channels' },
  { value: 'voice', label: 'Voice' },
  { value: 'web', label: 'Web' },
  { value: 'widget', label: 'Widget' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'sms', label: 'SMS' },
  { value: 'api', label: 'API' },
  { value: 'slack', label: 'Slack' },
]

export function SessionsFilters({ filters, onFiltersChange }: SessionsFiltersProps) {
  const { data: agentsData } = useQuery({
    queryKey: ['agents'],
    queryFn: () => api.get('agents').json<AgentListResponse>(),
  })

  const agentOptions = [
    { value: '', label: 'All Agents' },
    ...(agentsData?.items.map((agent) => ({ value: agent.id, label: agent.name })) || []),
  ]

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="w-64">
        <Input
          placeholder="Search sessions..."
          value={filters.search || ''}
          onChange={(e) =>
            onFiltersChange({
              ...filters,
              search: e.target.value || undefined,
            })
          }
          leftIcon={<Search className="h-4 w-4" />}
        />
      </div>
      <div className="w-36">
        <Select
          value={filters.status || ''}
          onChange={(e) =>
            onFiltersChange({
              ...filters,
              status: e.target.value ? (e.target.value as SessionStatus) : undefined,
            })
          }
        >
          {statusOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </Select>
      </div>
      <div className="w-36">
        <Select
          value={filters.channel_type || ''}
          onChange={(e) =>
            onFiltersChange({
              ...filters,
              channel_type: e.target.value ? (e.target.value as ChannelType) : undefined,
            })
          }
        >
          {channelOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </Select>
      </div>
      <div className="w-40">
        <Select
          value={filters.agent_id || ''}
          onChange={(e) =>
            onFiltersChange({
              ...filters,
              agent_id: e.target.value || undefined,
            })
          }
        >
          {agentOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </Select>
      </div>
    </div>
  )
}
