import { useState } from 'react'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import type { Connector } from '~/schemas/connectors'
import { SecretSelector } from './secret-selector'

interface ConnectorConfigFormProps {
  connector: Connector
  onSubmit: (config: Record<string, string>) => void
  isSubmitting: boolean
}

export function ConnectorConfigForm({
  connector,
  onSubmit,
  isSubmitting,
}: ConnectorConfigFormProps) {
  const [config, setConfig] = useState<Record<string, string>>({
    base_url: (connector.config.base_url as string) ?? '',
    api_token: (connector.config.api_token as string) ?? '',
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onSubmit(config)
  }

  const updateConfig = (key: string, value: string) => {
    setConfig((prev) => ({ ...prev, [key]: value }))
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Input
        label="Base URL"
        value={config.base_url}
        onChange={(e) => updateConfig('base_url', e.target.value)}
        placeholder="https://api.example.com"
        hint="The base URL for the API endpoint"
      />

      <SecretSelector
        label="API Token"
        value={config.api_token}
        onChange={(value) => updateConfig('api_token', value)}
      />

      <div className="pt-2">
        <Button type="submit" loading={isSubmitting} className="w-full">
          Save Configuration
        </Button>
      </div>
    </form>
  )
}
