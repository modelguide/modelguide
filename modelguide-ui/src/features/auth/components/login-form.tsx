import { useNavigate } from '@tanstack/react-router'
import { AlertCircle, ArrowLeft, CheckCircle, Eye, Mail } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '~/components/ui/button'
import { Label } from '~/components/ui/label'
import { getApiBaseUrl } from '~/lib/api-base'
import { magicLinkRequestSchema } from '~/schemas/auth'
import { useAuthStore } from '~/stores/auth'

const RESEND_COOLDOWN_SECONDS = 30

export interface LoginFormProps {
  redirectTo?: string
}

type Step = 'email' | 'sent'

export function LoginForm({ redirectTo }: LoginFormProps) {
  const requestMagicLink = useAuthStore((s) => s.requestMagicLink)

  const [email, setEmail] = useState('')
  const [step, setStep] = useState<Step>('email')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  const cooldownRef = useRef<ReturnType<typeof setInterval>>(null)

  const startCooldown = useCallback(() => {
    setCooldown(RESEND_COOLDOWN_SECONDS)
    if (cooldownRef.current) clearInterval(cooldownRef.current)
    cooldownRef.current = setInterval(() => {
      setCooldown((prev) => {
        if (prev <= 1) {
          if (cooldownRef.current) clearInterval(cooldownRef.current)
          cooldownRef.current = null
          return 0
        }
        return prev - 1
      })
    }, 1000)
  }, [])

  useEffect(() => {
    return () => {
      if (cooldownRef.current) clearInterval(cooldownRef.current)
    }
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    const result = magicLinkRequestSchema.safeParse({ email })
    if (!result.success) {
      setError(result.error.errors[0].message)
      return
    }

    setLoading(true)
    try {
      await requestMagicLink(email)
      setStep('sent')
      startCooldown()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send magic link')
    } finally {
      setLoading(false)
    }
  }

  const handleResend = async () => {
    setError(null)
    setLoading(true)
    try {
      await requestMagicLink(email)
      startCooldown()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resend magic link')
    } finally {
      setLoading(false)
    }
  }

  if (step === 'sent') {
    return (
      <div className="space-y-5">
        <div className="flex items-start gap-3 rounded-lg border border-success/30 bg-success/5 p-4">
          <CheckCircle className="mt-0.5 h-5 w-5 shrink-0 text-success" />
          <div>
            <p className="text-sm font-medium text-fg-primary">Check your email</p>
            <p className="mt-1 text-sm text-fg-secondary">
              We sent a magic link to <strong className="text-fg-primary">{email}</strong>. Click
              the link to sign in.
            </p>
          </div>
        </div>

        {error ? (
          <div className="flex items-center gap-2 rounded-lg border border-error/30 bg-error-muted p-3 text-sm text-error">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        ) : null}

        <div className="flex flex-col gap-3">
          <Button
            variant="secondary"
            onClick={handleResend}
            loading={loading}
            disabled={cooldown > 0}
            className="w-full"
          >
            <Mail className="h-4 w-4" />
            {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend magic link'}
          </Button>
          <button
            type="button"
            onClick={() => {
              setStep('email')
              setError(null)
            }}
            className="flex items-center justify-center gap-1.5 text-sm text-fg-muted hover:text-fg-secondary transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Use a different email
          </button>
        </div>
      </div>
    )
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
          className="w-full rounded-lg border border-fg-subtle/20 bg-bg-elevated px-4 py-3 text-fg-primary placeholder:text-fg-subtle transition-colors focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:opacity-50"
        />
      </div>

      {error ? (
        <div className="flex items-center gap-2 rounded-lg border border-error/30 bg-error-muted p-3 text-sm text-error">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      <Button type="submit" loading={loading} className="w-full mt-2">
        Send magic link
      </Button>

      <DemoSection redirectTo={redirectTo} />

      {import.meta.env.DEV ? <DevAccounts onSelect={setEmail} /> : null}
    </form>
  )
}

const DEV_ACCOUNTS = [
  { email: 'delivered+admin-pizza-palace@resend.dev', role: 'admin' },
  { email: 'delivered+support-pizza-palace@resend.dev', role: 'support' },
] as const

function DemoSection({ redirectTo }: { redirectTo?: string }) {
  const demoLogin = useAuthStore((s) => s.demoLogin)
  const navigate = useNavigate()
  const [demoAvailable, setDemoAvailable] = useState<boolean | null>(null)
  const [demoEmail, setDemoEmail] = useState('')
  const [demoError, setDemoError] = useState<string | null>(null)
  const [demoLoading, setDemoLoading] = useState(false)

  useEffect(() => {
    const baseUrl = getApiBaseUrl()
    fetch(`${baseUrl}/config`)
      .then((r) => {
        if (!r.ok) throw new Error('config fetch failed')
        return r.json()
      })
      .then((data: { demoMode: boolean }) => setDemoAvailable(data.demoMode))
      .catch(() => setDemoAvailable(false))
  }, [])

  if (demoAvailable !== true) return null

  const handleDemoSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setDemoError(null)

    const result = magicLinkRequestSchema.safeParse({ email: demoEmail })
    if (!result.success) {
      setDemoError(result.error.errors[0].message)
      return
    }

    setDemoLoading(true)
    try {
      await demoLogin(demoEmail)
      navigate({ to: redirectTo || '/' })
    } catch (err) {
      setDemoError(err instanceof Error ? err.message : 'Demo login failed')
    } finally {
      setDemoLoading(false)
    }
  }

  return (
    <div className="mt-6">
      <div className="flex items-center gap-3">
        <div className="h-px flex-1 bg-fg-subtle/20" />
        <span className="text-xs text-fg-muted">or</span>
        <div className="h-px flex-1 bg-fg-subtle/20" />
      </div>

      <form onSubmit={handleDemoSubmit} className="mt-4 space-y-3">
        <div className="flex items-center gap-2 text-sm text-fg-secondary">
          <Eye className="h-4 w-4 text-brand-500" />
          <span className="font-medium">Try the Demo</span>
        </div>
        <input
          type="email"
          value={demoEmail}
          onChange={(e) => setDemoEmail(e.target.value)}
          placeholder="your@email.com"
          autoComplete="email"
          disabled={demoLoading}
          required
          className="w-full rounded-lg border border-fg-subtle/20 bg-bg-elevated px-4 py-2.5 text-sm text-fg-primary placeholder:text-fg-subtle transition-colors focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:opacity-50"
        />
        {demoError ? (
          <div className="flex items-center gap-2 rounded-lg border border-error/30 bg-error-muted p-2.5 text-xs text-error">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            <span>{demoError}</span>
          </div>
        ) : null}
        <Button type="submit" variant="secondary" loading={demoLoading} className="w-full">
          <Eye className="h-4 w-4" />
          Start Demo
        </Button>
      </form>
    </div>
  )
}

function DevAccounts({ onSelect }: { onSelect: (email: string) => void }) {
  return (
    <div className="mt-3 rounded-xl border border-fg-subtle/20 bg-bg-elevated p-4">
      <p className="mb-3 font-display text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
        Dev Accounts (seed data)
      </p>
      <div className="space-y-1.5">
        {DEV_ACCOUNTS.map(({ email, role }) => (
          <button
            key={email}
            type="button"
            onClick={() => onSelect(email)}
            className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left transition-colors hover:bg-bg-subtle"
          >
            <span className="font-mono text-sm text-fg-primary">{email}</span>
            <span className="ml-2 shrink-0 rounded-md bg-bg-subtle px-2 py-0.5 font-mono text-xs text-fg-muted">
              {role}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
