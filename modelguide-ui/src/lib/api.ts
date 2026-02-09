import ky from 'ky'
import { getApiBaseUrl } from '~/lib/api-base'
import { useAuthStore, waitForHydration } from '~/stores/auth'

async function getValidToken(): Promise<string | null> {
  await waitForHydration()
  const { token, isAuthenticated, refreshAccessToken } = useAuthStore.getState()

  if (token) return token

  // No in-memory token but user is authenticated (page reload scenario).
  // refreshAccessToken() has its own storeRefreshPromise dedup — safe to call directly.
  if (isAuthenticated) {
    const success = await refreshAccessToken()
    if (success) {
      return useAuthStore.getState().token
    }
  }

  return null
}

export const api = ky.create({
  prefixUrl: getApiBaseUrl(),
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

        // Clear stale token so getValidToken knows to refresh.
        // refreshAccessToken() has its own storeRefreshPromise dedup — safe to call directly.
        useAuthStore.setState({ token: null })
        const success = await refreshAccessToken()
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
