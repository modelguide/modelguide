import { useNavigate } from '@tanstack/react-router'
import { AlertCircle, Lock, Mail } from 'lucide-react'
import { useState } from 'react'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
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
    <form onSubmit={handleSubmit} className="space-y-4">
      <Input
        label="Email"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="admin@modelguide.ai"
        leftIcon={<Mail className="h-4 w-4" />}
        autoComplete="email"
        disabled={loading}
        required
      />

      <Input
        label="Password"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Enter your password"
        leftIcon={<Lock className="h-4 w-4" />}
        autoComplete="current-password"
        disabled={loading}
        required
      />

      {error ? (
        <div className="flex items-center gap-2 rounded border border-error/30 bg-error-muted p-3 text-sm text-error">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      <Button type="submit" loading={loading} className="w-full">
        Sign in
      </Button>

      <p className="text-center font-sans text-xs text-fg-muted">
        Demo: admin@modelguide.ai / admin123
      </p>
    </form>
  )
}
