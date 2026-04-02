import { useMutation } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Phone, PhoneOff } from 'lucide-react'
import { type ReactNode, useCallback, useState } from 'react'
import { Button } from '~/components/ui/button'
import { Dialog } from '~/components/ui/dialog'
import { Input } from '~/components/ui/input'
import { api } from '~/lib/api'
import type { OutboundCallResponse } from '~/schemas/agents'

type CallPhase = 'idle' | 'dialing' | 'ringing' | 'completed' | 'error'

interface OutboundCallDialogProps {
  agentId: string
  trigger: ReactNode
}

export function OutboundCallDialog({ agentId, trigger }: OutboundCallDialogProps) {
  const [open, setOpen] = useState(false)
  const [phase, setPhase] = useState<CallPhase>('idle')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState('')

  const handleReset = useCallback(() => {
    setPhase('idle')
    setPhone('')
    setEmail('')
    setName('')
    setSessionId(null)
    setErrorMessage('')
  }, [])

  const handleClose = useCallback(() => {
    setOpen(false)
    handleReset()
  }, [handleReset])

  const callMutation = useMutation({
    mutationFn: (data: { phoneNumber: string; email?: string; name?: string }) =>
      api.post(`agents/${agentId}/outbound-call`, { json: data }).json<OutboundCallResponse>(),
    onSuccess: (data) => {
      setPhase('ringing')
      setSessionId(data.sessionId)
    },
    onError: (err) => {
      setPhase('error')
      setErrorMessage(err instanceof Error ? err.message : 'Failed to initiate call')
    },
  })

  function handleCall() {
    if (!phone.trim()) return
    setPhase('dialing')
    callMutation.mutate({
      phoneNumber: phone.trim(),
      email: email.trim() || undefined,
      name: name.trim() || undefined,
    })
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="appearance-none">
        {trigger}
      </button>

      <Dialog
        open={open}
        onClose={handleClose}
        size="sm"
        title={phase === 'idle' ? 'Make a Call' : undefined}
      >
        {phase === 'idle' ? (
          <div className="space-y-4">
            <Input
              label="Phone Number"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+1 555 123 4567"
              required
            />
            <Input
              label="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="customer@example.com"
            />
            <Input
              label="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="John Doe"
            />
            <Button onClick={handleCall} className="w-full" disabled={!phone.trim()}>
              <Phone className="h-4 w-4" />
              Call
            </Button>
          </div>
        ) : null}

        {phase === 'dialing' || phase === 'ringing' ? (
          <div className="flex flex-col items-center py-8 space-y-4">
            <div className="relative">
              <div className="absolute inset-0 animate-ping rounded-full bg-brand-500/20" />
              <div className="relative flex h-16 w-16 items-center justify-center rounded-full bg-brand-500/10">
                <Phone className="h-6 w-6 text-brand-500" />
              </div>
            </div>
            <p className="text-sm text-fg-secondary">
              {phase === 'dialing' ? 'Dialing...' : 'Ringing...'}
            </p>
            <p className="font-mono text-xs text-fg-muted">{phone}</p>
            {phase === 'ringing' && sessionId ? (
              <div className="flex flex-col items-center gap-2 pt-2">
                <p className="text-xs text-fg-muted">
                  Call dispatched — the agent will handle the conversation.
                </p>
                <Link
                  to="/sessions/$id"
                  params={{ id: sessionId }}
                  className="text-sm text-brand-500 hover:underline"
                >
                  View session
                </Link>
                <Button variant="secondary" size="sm" onClick={handleClose} className="mt-2">
                  Close
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}

        {phase === 'completed' ? (
          <div className="flex flex-col items-center py-8 space-y-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-fg-subtle/10">
              <PhoneOff className="h-6 w-6 text-fg-muted" />
            </div>
            <p className="text-sm text-fg-secondary">Call ended</p>
            {sessionId ? (
              <Link
                to="/sessions/$id"
                params={{ id: sessionId }}
                className="text-sm text-brand-500 hover:underline"
              >
                View session
              </Link>
            ) : null}
          </div>
        ) : null}

        {phase === 'error' ? (
          <div className="flex flex-col items-center py-8 space-y-4">
            <p className="text-sm text-error">{errorMessage}</p>
            <Button variant="secondary" onClick={handleReset}>
              Try Again
            </Button>
          </div>
        ) : null}
      </Dialog>
    </>
  )
}
