import { AlertTriangle, Check, Copy } from 'lucide-react'
import { useState } from 'react'
import { Button } from '~/components/ui/button'
import { Dialog, DialogFooter } from '~/components/ui/dialog'

export interface ApiKeyModalProps {
  open: boolean
  onClose: () => void
  apiKey: string
  title?: string
}

export function ApiKeyModal({
  open,
  onClose,
  apiKey,
  title = 'API Key Generated',
}: ApiKeyModalProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(apiKey)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Dialog open={open} onClose={onClose} title={title}>
      <div className="space-y-4">
        <p className="font-sans text-sm text-fg-secondary">Your API key (shown only once):</p>

        <div className="flex items-center gap-2 rounded border border-fg-subtle/20 bg-bg-base p-3">
          <code className="flex-1 font-mono text-sm text-fg-primary break-all">{apiKey}</code>
          <Button variant="ghost" size="icon-sm" onClick={handleCopy}>
            {copied ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
          </Button>
        </div>

        <div className="flex items-start gap-2 rounded border border-warning/30 bg-warning-muted p-3">
          <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />
          <p className="font-sans text-xs text-fg-secondary">
            Save this key securely. You won&apos;t be able to see it again.
          </p>
        </div>
      </div>

      <DialogFooter>
        <Button onClick={onClose}>Done</Button>
      </DialogFooter>
    </Dialog>
  )
}
