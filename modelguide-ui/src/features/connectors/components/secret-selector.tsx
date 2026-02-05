import { useQuery } from '@tanstack/react-query'
import { Key, Lock } from 'lucide-react'
import { api } from '~/lib/api'
import type { SecretListResponse } from '~/schemas/secrets'

interface SecretSelectorProps {
  value: string
  onChange: (value: string) => void
  label?: string
  error?: string
}

export function SecretSelector({
  value,
  onChange,
  label = 'API Token',
  error,
}: SecretSelectorProps) {
  const { data, isLoading } = useQuery({
    queryKey: ['secrets'],
    queryFn: () => api.get('secrets').json<SecretListResponse>(),
  })

  const secrets = data?.items ?? []

  return (
    <label className="block space-y-1.5">
      <span className="block font-mono text-xs font-medium text-fg-secondary">{label}</span>
      <div className="relative">
        <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-muted" />
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={isLoading}
          className={`
            h-10 w-full appearance-none rounded border bg-bg-base pl-9 pr-10 font-mono text-sm text-fg-primary
            transition focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand
            ${error ? 'border-error' : 'border-fg-subtle/30'}
          `}
        >
          <option value="">Select a secret...</option>
          {secrets.map((secret) => (
            <option key={secret.id} value={secret.id}>
              {secret.name}
            </option>
          ))}
        </select>
        <Key className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-muted" />
      </div>
      {error ? <p className="font-sans text-xs text-error">{error}</p> : null}
    </label>
  )
}
