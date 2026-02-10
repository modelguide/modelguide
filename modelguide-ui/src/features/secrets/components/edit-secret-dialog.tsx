import { useState } from 'react'
import { Button } from '~/components/ui/button'
import { Dialog } from '~/components/ui/dialog'
import { Input } from '~/components/ui/input'
import type { Secret, SecretUpdate } from '~/schemas/secrets'

interface EditSecretDialogProps {
  open: boolean
  onClose: () => void
  onConfirm: (data: SecretUpdate) => void
  secret: Secret | null
  isUpdating: boolean
}

export function EditSecretDialog({
  open,
  onClose,
  onConfirm,
  secret,
  isUpdating,
}: EditSecretDialogProps) {
  const [name, setName] = useState('')
  const [value, setValue] = useState('')
  const [initialized, setInitialized] = useState<string | null>(null)

  // Reset form when a different secret is opened
  if (secret && secret.id !== initialized) {
    setName(secret.name)
    setValue('')
    setInitialized(secret.id)
  }
  if (!secret && initialized) {
    setInitialized(null)
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const update: SecretUpdate = {}
    if (name.trim() && name.trim() !== secret?.name) {
      update.name = name.trim()
    }
    if (value.trim()) {
      update.value = value.trim()
    }
    if (update.name || update.value) {
      onConfirm(update)
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="Edit Secret">
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          label="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Secret name"
        />

        <Input
          type="password"
          label="New Value"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Leave blank to keep current value"
          hint="Only fill in to replace the existing value"
        />

        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={isUpdating}>
            Update Secret
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
