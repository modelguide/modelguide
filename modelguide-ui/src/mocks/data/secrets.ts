import type { Secret } from '~/schemas/secrets'

export const mockSecrets: Secret[] = [
  {
    id: '550e8400-e29b-41d4-a716-446655440030',
    name: 'Medusa Production Token',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
  },
  {
    id: '550e8400-e29b-41d4-a716-446655440031',
    name: 'Medusa Staging Token',
    created_at: '2024-01-05T00:00:00Z',
    updated_at: '2024-01-05T00:00:00Z',
  },
  {
    id: '550e8400-e29b-41d4-a716-446655440032',
    name: 'Zendesk API Key',
    created_at: '2024-01-08T00:00:00Z',
    updated_at: '2024-01-10T00:00:00Z',
  },
]

export function getSecretById(id: string): Secret | undefined {
  return mockSecrets.find((s) => s.id === id)
}
