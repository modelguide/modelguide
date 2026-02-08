import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Select } from '~/components/ui/select'
import { api } from '~/lib/api'
import type { PaginatedResponse } from '~/lib/pagination'
import type { Connector } from '~/schemas/connectors'
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
  const [ownerId, setOwnerId] = useState('')
  const [errors, setErrors] = useState<{
    name?: string
    value?: string
    ownerId?: string
  }>({})

  const { data: connectorsData, isLoading: connectorsLoading } = useQuery({
    queryKey: ['connectors'],
    queryFn: () => api.get('connectors').json<PaginatedResponse<Connector>>(),
  })

  const connectors = connectorsData?.data ?? []

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    const newErrors: typeof errors = {}
    if (!name.trim()) {
      newErrors.name = 'Name is required'
    }
    if (!value.trim()) {
      newErrors.value = 'Value is required'
    }
    if (!ownerId) {
      newErrors.ownerId = 'Connector is required'
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors)
      return
    }

    onSubmit({
      name: name.trim(),
      value: value.trim(),
      secretType,
      ownerType: 'connector',
      ownerId,
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
      </Select>

      <Select
        label="Connector"
        value={ownerId}
        onChange={(e) => {
          setOwnerId(e.target.value)
          setErrors((prev) => ({ ...prev, ownerId: undefined }))
        }}
        error={errors.ownerId}
        disabled={connectorsLoading}
      >
        <option value="">
          {connectorsLoading ? 'Loading connectors...' : 'Select a connector'}
        </option>
        {connectors.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name} ({c.slug})
          </option>
        ))}
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
