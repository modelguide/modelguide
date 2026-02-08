import {
  Outlet,
  createFileRoute,
  redirect,
  useNavigate,
  useRouterState,
} from '@tanstack/react-router'
import { useEffect } from 'react'
import { AppShell } from '~/components/layout/app-shell'
import { useAuthStore } from '~/stores/auth'

export const Route = createFileRoute('/_authenticated')({
  // Guard for initial navigation - runs before route renders
  beforeLoad: async ({ location, context }) => {
    const { isAuthenticated, token, refreshAccessToken } = useAuthStore.getState()

    // Allow access during dev autologin flow (before Zustand rehydrates)
    // Check for dev-autologin cookie on both server and client
    let isDevAutologin = false
    if (typeof document !== 'undefined') {
      // Client-side cookie check
      isDevAutologin = document.cookie.includes('__dev-login-done=1')
    } else if (context && 'req' in context) {
      // Server-side cookie check (Nitro/h3)
      const req = context.req as { headers?: { cookie?: string } }
      const cookies = req.headers?.cookie || ''
      isDevAutologin = cookies.includes('__dev-login-done=1')
    }

    if (!isAuthenticated && !isDevAutologin) {
      throw redirect({
        to: '/login',
        search: {
          redirect: location.pathname,
        },
      })
    }

    // Authenticated but no in-memory token (page reload) — attempt silent refresh
    if (!token) {
      const success = await refreshAccessToken()
      if (!success) {
        // Refresh failed — clear auth state and redirect to login
        useAuthStore.setState({ user: null, token: null, isAuthenticated: false })
        throw redirect({
          to: '/login',
          search: {
            redirect: location.pathname,
          },
        })
      }
    }
  },
  component: AuthenticatedLayout,
})

function AuthenticatedLayout() {
  const { user, logout, isAuthenticated } = useAuthStore()
  const navigate = useNavigate()
  const location = useRouterState({ select: (state) => state.location })

  // Reactive guard for mid-session logout (e.g., 401 response, manual logout)
  // Complements beforeLoad which only runs on initial navigation
  useEffect(() => {
    if (!isAuthenticated) {
      navigate({
        to: '/login',
        search: { redirect: location.pathname },
        replace: true,
      })
    }
  }, [isAuthenticated, location.pathname, navigate])

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
