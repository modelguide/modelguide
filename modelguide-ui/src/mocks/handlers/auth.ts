import { http, HttpResponse, delay } from 'msw'
import { findUserByCredentials, generateMockToken } from '~/mocks/data/users'

export const authHandlers = [
  http.post('*/api/auth/login', async ({ request }) => {
    await delay(300) // Simulate network latency

    const body = await request.json()
    const { email, password } = body as { email: string; password: string }

    const user = findUserByCredentials(email, password)

    if (!user) {
      return HttpResponse.json({ error: 'Invalid credentials' }, { status: 401 })
    }

    const { password: _, ...userWithoutPassword } = user
    const token = generateMockToken(user.id)

    return HttpResponse.json({
      user: userWithoutPassword,
      token,
    })
  }),

  http.post('*/api/auth/refresh', async () => {
    await delay(100)

    // In MSW mode, always return the first mock user with a fresh token
    const { mockUsers } = await import('~/mocks/data/users')
    const user = mockUsers[0]

    if (!user) {
      return HttpResponse.json(
        { code: 'REFRESH_TOKEN_INVALID', message: 'No refresh token' },
        { status: 401 },
      )
    }

    const { password: _, ...userWithoutPassword } = user
    const token = generateMockToken(user.id)

    return HttpResponse.json({
      user: userWithoutPassword,
      token,
    })
  }),

  http.post('*/api/auth/logout', async () => {
    await delay(100)
    return HttpResponse.json({ message: 'Logged out successfully' })
  }),

  http.get('*/api/auth/me', async ({ request }) => {
    await delay(100)

    const authHeader = request.headers.get('Authorization')
    if (!authHeader?.startsWith('Bearer mock_jwt_')) {
      return HttpResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Extract user ID from token
    const token = authHeader.replace('Bearer ', '')
    const parts = token.split('_')
    if (parts.length < 3) {
      return HttpResponse.json({ error: 'Invalid token' }, { status: 401 })
    }

    const userId = parts[2]
    const { mockUsers } = await import('~/mocks/data/users')
    const user = mockUsers.find((u) => u.id === userId)

    if (!user) {
      return HttpResponse.json({ error: 'User not found' }, { status: 401 })
    }

    const { password: _, ...userWithoutPassword } = user
    return HttpResponse.json({ user: userWithoutPassword })
  }),
]
