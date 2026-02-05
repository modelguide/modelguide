import type { User } from '~/schemas/auth'

export const mockUsers: Array<User & { password: string }> = [
  {
    id: '550e8400-e29b-41d4-a716-446655440001',
    email: 'admin@modelguide.ai',
    name: 'Alex Admin',
    role: 'admin',
    organization_id: '550e8400-e29b-41d4-a716-446655440000',
    password: 'admin123',
  },
  {
    id: '550e8400-e29b-41d4-a716-446655440002',
    email: 'support@modelguide.ai',
    name: 'Sam Support',
    role: 'support',
    organization_id: '550e8400-e29b-41d4-a716-446655440000',
    password: 'support123',
  },
]

export function findUserByCredentials(email: string, password: string) {
  return mockUsers.find((u) => u.email === email && u.password === password)
}

export function generateMockToken(userId: string): string {
  return `mock_jwt_${userId}_${Date.now()}`
}
