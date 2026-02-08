import { AlertCircle, ArrowLeft, CheckCircle, Mail } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '~/components/ui/button'
import { Label } from '~/components/ui/label'
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
    </form>
  )
}
