import { Outlet, createFileRoute, redirect } from '@tanstack/react-router'
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
  const { user, logout } = useAuthStore()

  if (!user) {
    return null
  }

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
