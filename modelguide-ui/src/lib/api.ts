import ky from 'ky'
import { useAuthStore } from '~/stores/auth'

let refreshPromise: Promise<boolean> | null = null

async function getValidToken(): Promise<string | null> {
  const { token, isAuthenticated, refreshAccessToken } = useAuthStore.getState()

  if (token) return token

  // No in-memory token but user is authenticated (page reload scenario)
  if (isAuthenticated) {
    if (!refreshPromise) {
      refreshPromise = refreshAccessToken().finally(() => {
        refreshPromise = null
      })
    }

    const success = await refreshPromise
    if (success) {
      return useAuthStore.getState().token
    }
  }

  return null
}

export const api = ky.create({
  prefixUrl: '/api',
  credentials: 'include',
  hooks: {
    beforeRequest: [
      async (request) => {
        const token = await getValidToken()
        if (token) {
          request.headers.set('Authorization', `Bearer ${token}`)
        }
      },
    ],
    afterResponse: [
      async (request, options, response) => {
        if (response.status !== 401) {
          return response
        }

        // Prevent infinite retry loop — don't retry a request that already retried
        if (request.headers.get('X-Retry-After-Refresh')) {
          return response
        }

        // 401 received — attempt refresh
        const { isAuthenticated, refreshAccessToken, logout } = useAuthStore.getState()

        if (!isAuthenticated) {
          return response
        }

        if (!refreshPromise) {
          // Clear stale token so getValidToken knows to refresh
          useAuthStore.setState({ token: null })
          refreshPromise = refreshAccessToken().finally(() => {
            refreshPromise = null
          })
        }

        const success = await refreshPromise
        if (!success) {
          await logout()
          return response
        }

        // Retry the original request with the new token
        const newToken = useAuthStore.getState().token
        if (newToken) {
          request.headers.set('Authorization', `Bearer ${newToken}`)
        }
        request.headers.set('X-Retry-After-Refresh', '1')

        return ky(request, options)
      },
    ],
  },
})
