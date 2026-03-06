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
  const [scope, setScope] = useState<string>('')
  const [errors, setErrors] = useState<{
    name?: string
    value?: string
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

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors)
      return
    }

    onSubmit({
      name: name.trim(),
      value: value.trim(),
      secretType,
      ...(scope ? { scope: scope as 'connector' | 'agent' } : {}),
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
        }}
      >
        <option value="api_key">API Key</option>
        <option value="oauth_token">OAuth Token</option>
        <option value="credentials">Credentials</option>
        <option value="platform_api_key">Platform API Key</option>
        <option value="webhook_secret">Webhook Secret</option>
      </Select>

      <Select
        label="Scope"
        value={scope}
        onChange={(e) => {
          setScope(e.target.value)
        }}
      >
        <option value="">Unscoped (visible everywhere)</option>
        <option value="connector">Connector</option>
        <option value="agent">Agent</option>
      </Select>

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
