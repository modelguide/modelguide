import { createFileRoute, redirect } from '@tanstack/react-router'
import { Logo } from '~/components/layout/logo'
import { Card } from '~/components/ui/card'
import { LoginForm } from '~/features/auth/components/login-form'
import { useAuthStore } from '~/stores/auth'

export const Route = createFileRoute('/login')({
  beforeLoad: async () => {
    const { isAuthenticated } = useAuthStore.getState()
    if (isAuthenticated) {
      throw redirect({ to: '/' })
    }
  },
  component: LoginPage,
})

function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg-base p-4">
      <div className="w-full max-w-sm animate-fade-up">
        {/* Logo */}
        <div className="mb-8 text-center">
          <Logo size="lg" />
          <p className="mt-2 font-sans text-sm text-fg-secondary">Sign in to your dashboard</p>
        </div>

        {/* Login Form */}
        <Card>
          <LoginForm />
        </Card>
      </div>
    </div>
  )
}
