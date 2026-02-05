import type { Agent } from '~/schemas/agents'

export const mockAgents: Agent[] = [
  {
    id: '550e8400-e29b-41d4-a716-446655440010',
    name: 'Pizza Palace Assistant',
    description: 'Voice ordering assistant for Pizza Palace restaurant chain',
    agent_type: 'voice',
    is_active: true,
    key_prefix: 'mgk_a1b2',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-10T00:00:00Z',
  },
  {
    id: '550e8400-e29b-41d4-a716-446655440011',
    name: 'Support Bot',
    description: 'General customer support agent',
    agent_type: 'voice',
    is_active: true,
    key_prefix: 'mgk_c3d4',
    created_at: '2024-01-05T00:00:00Z',
    updated_at: '2024-01-05T00:00:00Z',
  },
  {
    id: '550e8400-e29b-41d4-a716-446655440012',
    name: 'Booking Agent',
    description: 'Appointment scheduling assistant',
    agent_type: 'voice',
    is_active: false,
    key_prefix: 'mgk_e5f6',
    created_at: '2024-01-08T00:00:00Z',
    updated_at: '2024-01-12T00:00:00Z',
  },
]

export function getAgentById(id: string): Agent | undefined {
  return mockAgents.find((a) => a.id === id)
}
