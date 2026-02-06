import { createFileRoute, redirect } from '@tanstack/react-router'
import { Logo } from '~/components/layout/logo'
import { LoginForm } from '~/features/auth/components/login-form'
import { useAuthStore } from '~/stores/auth'

export const Route = createFileRoute('/login')({
  validateSearch: (search) => ({
    redirect: typeof search.redirect === 'string' ? search.redirect : undefined,
  }),
  beforeLoad: async () => {
    const { isAuthenticated } = useAuthStore.getState()
    if (isAuthenticated) {
      throw redirect({ to: '/' })
    }
  },
  component: LoginPage,
})

function LoginPage() {
  const { redirect: redirectTo } = Route.useSearch()

  return (
    <div className="flex min-h-screen">
      {/* Left Panel - Login Form */}
      <div className="flex w-full flex-col justify-center px-8 py-12 lg:w-1/2 lg:px-16 xl:px-24">
        <div className="mx-auto w-full max-w-md animate-fade-up">
          {/* Logo */}
          <div className="mb-10">
            <Logo size="md" />
          </div>

          {/* Header */}
          <div className="mb-8">
            <h1 className="font-display text-3xl font-bold tracking-tight text-fg-primary">
              Welcome back
            </h1>
            <p className="mt-2 text-fg-muted">Sign in to your account to continue</p>
          </div>

          {/* Form */}
          <LoginForm redirectTo={redirectTo} />

          {/* Forgot Password */}
          <div className="mt-6 text-center">
            <button
              type="button"
              className="text-sm text-fg-muted hover:text-fg-secondary transition-colors"
            >
              Forgot your password?
            </button>
          </div>

          {/* Demo Credentials */}
          <div className="mt-8 rounded-xl border border-fg-subtle/20 bg-bg-elevated p-4">
            <p className="mb-3 font-display text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
              Demo Credentials
            </p>
            <div className="space-y-2 font-mono text-sm">
              <div className="flex items-center justify-between">
                <span className="text-fg-primary">admin@modelguide.ai</span>
                <span className="text-fg-muted">admin123</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-fg-primary">support@modelguide.ai</span>
                <span className="text-fg-muted">support123</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Right Panel - Branding */}
      <div className="hidden lg:flex lg:w-1/2 flex-col items-center justify-center bg-bg-base relative overflow-hidden">
        {/* Gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-br from-brand-500/5 via-transparent to-brand-500/10" />

        {/* Content */}
        <div
          className="relative z-10 max-w-md px-8 text-center animate-fade-up"
          style={{ animationDelay: '100ms' }}
        >
          {/* Logo Icon */}
          <div className="mx-auto mb-8 flex h-20 w-20 items-center justify-center rounded-2xl bg-brand-500/15 shadow-lg shadow-brand-500/10">
            <span className="font-display text-2xl font-bold text-brand-400">
              {'{'}
              <span className="text-brand-500">m</span>
              {'}'}
            </span>
          </div>

          {/* Headline */}
          <h2 className="font-display text-3xl font-bold tracking-tight text-fg-primary">
            AI-Powered Support,
            <br />
            Simplified
          </h2>

          {/* Description */}
          <p className="mt-4 text-fg-secondary leading-relaxed">
            Configure agents, connect your tools, and deliver exceptional customer experiences with
            intelligent voice and chat automation.
          </p>
        </div>

        {/* Decorative elements */}
        <div className="absolute -bottom-20 -right-20 h-64 w-64 rounded-full bg-brand-500/5 blur-3xl" />
        <div className="absolute -top-20 -left-20 h-64 w-64 rounded-full bg-brand-500/5 blur-3xl" />
      </div>
    </div>
  )
}
