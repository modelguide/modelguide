import { AlertTriangle } from 'lucide-react'
import { Button } from '~/components/ui/button'
import { Dialog, DialogFooter } from '~/components/ui/dialog'
import type { Secret } from '~/schemas/secrets'

interface DeleteSecretDialogProps {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  secret: Secret | null
  isDeleting: boolean
}

export function DeleteSecretDialog({
  open,
  onClose,
  onConfirm,
  secret,
  isDeleting,
}: DeleteSecretDialogProps) {
  if (!secret) return null

  return (
    <Dialog open={open} onClose={onClose} title="Delete Secret">
      <div className="space-y-4">
        <div className="flex items-start gap-3 rounded-lg border border-warning/30 bg-warning/10 p-4">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
          <div>
            <p className="font-sans text-sm text-fg-primary">
              This will permanently delete the secret{' '}
              <strong className="font-mono">{secret.name}</strong>.
            </p>
            <p className="mt-2 font-sans text-sm text-fg-secondary">
              Any connectors using this secret will stop working. This action cannot be undone.
            </p>
          </div>
        </div>
      </div>
      <DialogFooter>
        <Button variant="secondary" onClick={onClose} disabled={isDeleting}>
          Cancel
        </Button>
        <Button variant="danger" onClick={onConfirm} loading={isDeleting}>
          Delete Secret
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
