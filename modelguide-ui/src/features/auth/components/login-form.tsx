import { useNavigate } from '@tanstack/react-router'
import { AlertCircle } from 'lucide-react'
import { useState } from 'react'
import { Button } from '~/components/ui/button'
import { Label } from '~/components/ui/label'
import { loginRequestSchema } from '~/schemas/auth'
import { useAuthStore } from '~/stores/auth'

export interface LoginFormProps {
  redirectTo?: string
}

export function LoginForm({ redirectTo }: LoginFormProps) {
  const navigate = useNavigate()
  const login = useAuthStore((s) => s.login)

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    // Validate
    const result = loginRequestSchema.safeParse({ email, password })
    if (!result.success) {
      setError(result.error.errors[0].message)
      return
    }

    setLoading(true)
    try {
      await login(email, password)
      const safeRedirect =
        redirectTo && redirectTo.startsWith('/') ? redirectTo : '/'
      navigate({ to: safeRedirect })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <Label htmlFor="email">Email</Label>
        <input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@company.com"
          autoComplete="email"
          disabled={loading}
          required
          className="w-full rounded-lg border border-fg-subtle/20 bg-bg-elevated px-4 py-3 text-fg-primary placeholder:text-fg-subtle transition-colors focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:opacity-50"
        />
      </div>

      <div>
        <Label htmlFor="password">Password</Label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
          autoComplete="current-password"
          disabled={loading}
          required
          className="w-full rounded-lg border border-fg-subtle/20 bg-bg-elevated px-4 py-3 text-fg-primary placeholder:text-fg-subtle transition-colors focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:opacity-50"
        />
      </div>

      {error ? (
        <div className="flex items-center gap-2 rounded-lg border border-error/30 bg-error-muted p-3 text-sm text-error">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      <Button type="submit" loading={loading} className="w-full mt-2">
        Sign in
      </Button>
    </form>
  )
}
