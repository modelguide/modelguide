import { useState } from 'react'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Select } from '~/components/ui/select'
import type { SecretCreate } from '~/schemas/secrets'

interface SecretFormProps {
  onSubmit: (data: SecretCreate) => void
  onCancel: () => void
  isSubmitting: boolean
}

export function SecretForm({ onSubmit, onCancel, isSubmitting }: SecretFormProps) {
  const [name, setName] = useState('')
  const [value, setValue] = useState('')
  const [secretType, setSecretType] = useState<SecretCreate['secretType']>('api_key')
  const [ownerType, setOwnerType] = useState('connector')
  const [ownerId, setOwnerId] = useState('')
  const [errors, setErrors] = useState<{
    name?: string
    value?: string
    secretType?: string
    ownerType?: string
    ownerId?: string
  }>({})

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    const newErrors: typeof errors = {}
    if (!name.trim()) {
      newErrors.name = 'Name is required'
    }
    if (!value.trim()) {
      newErrors.value = 'Value is required'
    }
    if (!ownerType.trim()) {
      newErrors.ownerType = 'Owner type is required'
    }
    if (!ownerId.trim()) {
      newErrors.ownerId = 'Owner ID is required'
    } else {
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      if (!uuidRegex.test(ownerId.trim())) {
        newErrors.ownerId = 'Owner ID must be a valid UUID'
      }
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors)
      return
    }

    onSubmit({
      name: name.trim(),
      value: value.trim(),
      secretType,
      ownerType: ownerType.trim(),
      ownerId: ownerId.trim(),
    })
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

      <Select
        label="Secret Type"
        value={secretType}
        onChange={(e) => {
          setSecretType(e.target.value as SecretCreate['secretType'])
          setErrors((prev) => ({ ...prev, secretType: undefined }))
        }}
        error={errors.secretType}
      >
        <option value="api_key">API Key</option>
        <option value="oauth_token">OAuth Token</option>
        <option value="credentials">Credentials</option>
      </Select>

      <Select
        label="Owner Type"
        value={ownerType}
        onChange={(e) => {
          setOwnerType(e.target.value)
          setErrors((prev) => ({ ...prev, ownerType: undefined }))
        }}
        error={errors.ownerType}
      >
        <option value="connector">Connector</option>
      </Select>

      <Input
        label="Owner ID"
        value={ownerId}
        onChange={(e) => {
          setOwnerId(e.target.value)
          setErrors((prev) => ({ ...prev, ownerId: undefined }))
        }}
        placeholder="e.g., 550e8400-e29b-41d4-a716-446655440000"
        error={errors.ownerId}
        hint="The UUID of the connector that owns this secret"
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
