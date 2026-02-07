import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { AlertCircle } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Logo } from '~/components/layout/logo'
import { Button } from '~/components/ui/button'
import { Spinner } from '~/components/ui/spinner'
import { useAuthStore } from '~/stores/auth'

export const Route = createFileRoute('/auth/verify')({
  validateSearch: (search) => ({
    token: typeof search.token === 'string' ? search.token : '',
    redirect: typeof search.redirect === 'string' ? search.redirect : undefined,
  }),
  head: () => ({
    meta: [{ name: 'referrer', content: 'no-referrer' }],
  }),
  component: VerifyPage,
})

function VerifyPage() {
  const { token, redirect: redirectTo } = Route.useSearch()
  const navigate = useNavigate()
  const verifyToken = useAuthStore((s) => s.verifyToken)

  const [error, setError] = useState<string | null>(null)
  const attemptedRef = useRef(false)

  useEffect(() => {
    if (attemptedRef.current) return
    attemptedRef.current = true

    if (!token) {
      setError('No verification token provided')
      return
    }

    verifyToken(token)
      .then(() => {
        const safeRedirect = redirectTo?.startsWith('/') ? redirectTo : '/'
        navigate({ to: safeRedirect, replace: true })
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Verification failed')
      })
  }, [token, redirectTo, navigate, verifyToken])

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg-base">
      <div className="mx-auto w-full max-w-sm px-6 text-center">
        <div className="mb-8">
          <Logo size="md" />
        </div>

        {error ? (
          <div className="space-y-4">
            <div className="flex items-center justify-center gap-2 rounded-lg border border-error/30 bg-error-muted p-4 text-sm text-error">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
            <Button
              variant="secondary"
              onClick={() =>
                navigate({ to: '/login', search: { redirect: undefined }, replace: true })
              }
            >
              Back to login
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <Spinner size="lg" />
            <p className="text-sm text-fg-muted">Verifying your sign-in link...</p>
          </div>
        )}
      </div>
    </div>
  )
}
