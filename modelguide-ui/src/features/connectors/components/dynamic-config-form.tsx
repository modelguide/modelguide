import { Check } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import type { ConfigField } from '~/schemas/connectors'
import { SecretSelector } from './secret-selector'

interface DynamicConfigFormProps {
  configSchema: Record<string, ConfigField>
  values: Record<string, unknown>
  onChange: (values: Record<string, unknown>) => void
  /** When provided, renders as a standalone form with submit button */
  onSubmit?: () => void
  isSubmitting?: boolean
  /** Increment to trigger saved indicator (e.g. mutation submittedAt) */
  successKey?: number
  error?: string
  submitLabel?: string
}

export function DynamicConfigForm({
  configSchema,
  values,
  onChange,
  onSubmit,
  isSubmitting = false,
  successKey = 0,
  error,
  submitLabel = 'Save Configuration',
}: DynamicConfigFormProps) {
  const [showSaved, setShowSaved] = useState(false)

  useEffect(() => {
    if (successKey > 0) {
      setShowSaved(true)
      const timer = setTimeout(() => setShowSaved(false), 2500)
      return () => clearTimeout(timer)
    }
  }, [successKey])

  const updateValue = (key: string, value: unknown) => {
    onChange({ ...values, [key]: value })
  }

  const isValid = Object.entries(configSchema).every(([key, field]) => {
    if (!field.required) return true
    const value = values[key]
    return value !== undefined && value !== null && value !== ''
  })

  const fields = (
    <>
      {Object.entries(configSchema).map(([key, field]) => {
        if (field.type === 'secret') {
          return (
            <SecretSelector
              key={key}
              label={formatLabel(key)}
              value={(values[key] as string) ?? ''}
              onChange={(value) => updateValue(key, value)}
            />
          )
        }

        return (
          <Input
            key={key}
            label={formatLabel(key)}
            value={(values[key] as string) ?? ''}
            onChange={(e) => updateValue(key, e.target.value)}
            placeholder={field.description}
            hint={field.description}
            required={field.required}
          />
        )
      })}
    </>
  )

  if (Object.keys(configSchema).length === 0) {
    return (
      <p className="font-sans text-sm text-fg-muted">This connector has no configuration fields.</p>
    )
  }

  // Standalone mode: wrap in form with submit button
  if (onSubmit) {
    const handleSubmit = (e: React.FormEvent) => {
      e.preventDefault()
      onSubmit()
    }

    return (
      <form onSubmit={handleSubmit} className="space-y-4">
        {fields}
        {error ? <p className="font-sans text-sm text-error">{error}</p> : null}
        <div className="pt-2">
          {showSaved ? (
            <div className="flex h-10 w-full items-center justify-center gap-1.5 rounded-xl text-sm font-medium text-success">
              <Check className="h-4 w-4" />
              Saved
            </div>
          ) : (
            <Button type="submit" loading={isSubmitting} disabled={!isValid} className="w-full">
              {submitLabel}
            </Button>
          )}
        </div>
      </form>
    )
  }

  // Embedded mode: just render the fields
  return <div className="space-y-4">{fields}</div>
}

/** Convert snake_case or camelCase key to a human-readable label */
function formatLabel(key: string): string {
  return key
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}
