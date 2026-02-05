import { useState } from 'react'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import type { SecretCreate } from '~/schemas/secrets'

interface SecretFormProps {
  onSubmit: (data: SecretCreate) => void
  onCancel: () => void
  isSubmitting: boolean
}

export function SecretForm({ onSubmit, onCancel, isSubmitting }: SecretFormProps) {
  const [name, setName] = useState('')
  const [value, setValue] = useState('')
  const [errors, setErrors] = useState<{ name?: string; value?: string }>({})

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    const newErrors: { name?: string; value?: string } = {}
    if (!name.trim()) {
      newErrors.name = 'Name is required'
    }
    if (!value.trim()) {
      newErrors.value = 'Value is required'
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors)
      return
    }

    onSubmit({ name: name.trim(), value: value.trim() })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Input
        label="Name"
        value={name}
        onChange={(e) => {
          setName(e.target.value)
          setErrors((prev) => ({ ...prev, name: undefined }))
        }}
        placeholder="e.g., Stripe API Key"
        error={errors.name}
        hint="A descriptive name to identify this secret"
      />

      <Input
        type="password"
        label="Value"
        value={value}
        onChange={(e) => {
          setValue(e.target.value)
          setErrors((prev) => ({ ...prev, value: undefined }))
        }}
        placeholder="••••••••••••••••"
        error={errors.value}
        hint="The secret value (API key, token, password)"
      />

      <div className="flex justify-end gap-3 pt-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={isSubmitting}>
          Create Secret
        </Button>
      </div>
    </form>
  )
}
