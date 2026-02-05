import { Outlet, createFileRoute, redirect, useNavigate, useRouterState } from '@tanstack/react-router'
import { useEffect } from 'react'
import { AppShell } from '~/components/layout/app-shell'
import { useAuthStore } from '~/stores/auth'

export const Route = createFileRoute('/_authenticated')({
  beforeLoad: async ({ location }) => {
    const { isAuthenticated } = useAuthStore.getState()
    if (!isAuthenticated) {
      throw redirect({
        to: '/login',
        search: {
          redirect: location.pathname,
        },
      })
    }
  },
  component: AuthenticatedLayout,
})

function AuthenticatedLayout() {
  const { user, logout, isAuthenticated } = useAuthStore()
  const navigate = useNavigate()
  const location = useRouterState({ select: (state) => state.location })

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
