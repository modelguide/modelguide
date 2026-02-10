import { useMutation, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Check, Loader2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '~/components/ui/button'
import { Dialog, DialogFooter } from '~/components/ui/dialog'
import { api } from '~/lib/api'
import type { SyncResponse, SyncStep } from '~/schemas/agents'

interface SyncDialogProps {
  agentId: string
  open: boolean
  onClose: () => void
}

const SYNC_STEP_LABELS = [
  'Creating API key secret...',
  'Configuring MCP server...',
  'Setting up post-call webhook...',
  'Updating agent configuration...',
  'Saving sync results...',
]

type Phase = 'confirm' | 'progress'

export function SyncDialog({ agentId, open, onClose }: SyncDialogProps) {
  const queryClient = useQueryClient()
  const [phase, setPhase] = useState<Phase>('confirm')
  const [visibleSteps, setVisibleSteps] = useState(0)
  const [result, setResult] = useState<SyncResponse | null>(null)

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setPhase('confirm')
      setVisibleSteps(0)
      setResult(null)
    }
  }, [open])

  const syncMutation = useMutation({
    mutationFn: () => api.post(`agents/${agentId}/sync`, { timeout: 60_000 }).json<SyncResponse>(),
    onSuccess: (data) => {
      setResult(data)
      queryClient.invalidateQueries({ queryKey: ['agents', agentId] })
    },
  })

  // Animate step reveal while waiting for API response
  useEffect(() => {
    if (phase !== 'progress' || result || syncMutation.isError) return

    const interval = setInterval(() => {
      setVisibleSteps((prev) => {
        if (prev >= SYNC_STEP_LABELS.length - 1) return prev
        return prev + 1
      })
    }, 600)

    return () => clearInterval(interval)
  }, [phase, result, syncMutation.isError])

  const handleContinue = () => {
    setPhase('progress')
    setVisibleSteps(0)
    syncMutation.mutate()
  }

  const isDone = !!result
  const isError = syncMutation.isError

  // Map API steps to display, or show placeholder labels while loading
  const displaySteps: { label: string; status: SyncStep['status'] | 'pending' | 'loading' }[] =
    result
      ? result.steps.map((s) => ({
          label: s.step + (s.message ? ` — ${s.message}` : ''),
          status: s.status,
        }))
      : SYNC_STEP_LABELS.map((label, i) => ({
          label,
          status: i < visibleSteps ? 'loading' : i === visibleSteps ? 'loading' : 'pending',
        }))

  return (
    <Dialog open={open} onClose={onClose} title="Sync to ElevenLabs" size="md">
      {phase === 'confirm' ? (
        <>
          <div className="flex items-start gap-3 rounded-lg border border-warning/30 bg-warning/5 p-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <p className="text-sm text-fg-secondary">
              This will overwrite MCP server and post-call webhook configuration on your ElevenLabs
              agent.
            </p>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={handleContinue}>Continue</Button>
          </DialogFooter>
        </>
      ) : (
        <>
          <div className="space-y-3">
            {displaySteps.map((step, i) => (
              <div
                key={step.label}
                className={`flex items-center gap-3 text-sm transition-opacity ${
                  !result && i > visibleSteps ? 'opacity-30' : 'opacity-100'
                }`}
              >
                {step.status === 'success' || step.status === 'skipped' ? (
                  <Check className="h-4 w-4 shrink-0 text-success" />
                ) : step.status === 'error' ? (
                  <X className="h-4 w-4 shrink-0 text-error" />
                ) : step.status === 'loading' ? (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin text-brand-500" />
                ) : (
                  <div className="h-4 w-4 shrink-0 rounded-full border border-fg-subtle/30" />
                )}
                <span className={step.status === 'error' ? 'text-error' : 'text-fg-secondary'}>
                  {step.label}
                </span>
              </div>
            ))}

            {isError && !result ? (
              <div className="mt-2 rounded border border-error/30 bg-error/5 p-2 text-xs text-error">
                {syncMutation.error instanceof Error ? syncMutation.error.message : 'Sync failed'}
              </div>
            ) : null}
          </div>

          <DialogFooter>
            <Button variant={isDone ? 'primary' : 'secondary'} onClick={onClose}>
              {isDone ? 'Done' : 'Close'}
            </Button>
          </DialogFooter>
        </>
      )}
    </Dialog>
  )
}
