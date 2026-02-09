import { useQueryClient } from '@tanstack/react-query'
import {
  Outlet,
  createFileRoute,
  redirect,
  useNavigate,
  useRouterState,
} from '@tanstack/react-router'
import { useEffect, useRef } from 'react'
import { AppShell } from '~/components/layout/app-shell'
import { queryClient } from '~/lib/query-client'
import { useAuthStore, waitForHydration } from '~/stores/auth'

export const Route = createFileRoute('/_authenticated')({
  // Guard for initial navigation — runs before route renders
  beforeLoad: async ({ location }) => {
    await waitForHydration()

    const { isAuthenticated, token } = useAuthStore.getState()

    if (!isAuthenticated) {
      throw redirect({
        to: '/login',
        search: {
          redirect: location.pathname,
        },
      })
    }

    // Authenticated but no in-memory token (page reload) — attempt silent refresh
    if (!token) {
      const result = await useAuthStore.getState().tryRefresh()
      if (result === 'auth_error') {
        // Server rejected the cookie — session is dead, clear state
        queryClient.clear()
        useAuthStore.setState({ user: null, token: null, isAuthenticated: false })
        throw redirect({
          to: '/login',
          search: {
            redirect: location.pathname,
          },
        })
      }
      // 'network_error': cookie may still be valid. Let the route render with
      // stale user data — the ky 401 interceptor will retry when connectivity returns.
      // 'success': token is now in memory, proceed normally.
    }
  },
  component: AuthenticatedLayout,
})

function AuthenticatedLayout() {
  const { user, logout, isAuthenticated, refreshAccessToken } = useAuthStore()
  const navigate = useNavigate()
  const location = useRouterState({ select: (state) => state.location })
  const qc = useQueryClient()

  // Reactive guard for mid-session logout (e.g., 401 response, manual logout)
  // Complements beforeLoad which only runs on initial navigation
  useEffect(() => {
    if (!isAuthenticated) {
      qc.clear()
      navigate({
        to: '/login',
        search: { redirect: location.pathname },
        replace: true,
      })
    }
  }, [isAuthenticated, location.pathname, navigate, qc])

  // Proactive token refresh when tab becomes visible again.
  // Prevents 401-retry-refresh cycle when tab has been idle > 15 min.
  const lastRefreshRef = useRef(0)
  useEffect(() => {
    function handleVisibilityChange() {
      if (
        document.visibilityState === 'visible' &&
        isAuthenticated &&
        Date.now() - lastRefreshRef.current > 60_000 // 1-min throttle
      ) {
        lastRefreshRef.current = Date.now()
        refreshAccessToken()
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [isAuthenticated, refreshAccessToken])

  if (!user) return null

  return (
    <AppShell
      user={{
        name: user.name,
        email: user.email,
        role: user.role,
      }}
      onLogout={logout}
    />
  )
}
