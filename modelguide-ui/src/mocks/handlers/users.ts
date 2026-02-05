import { http, HttpResponse, delay } from 'msw'
import { mockUsers } from '~/mocks/data/users'

export const userHandlers = [
  http.get('/api/users', async () => {
    await delay(200)
    return HttpResponse.json({
      items: mockUsers.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        created_at: '2024-01-01T00:00:00Z',
      })),
      total: mockUsers.length,
    })
  }),
]
