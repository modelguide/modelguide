import { useMutation } from '@tanstack/react-query'
import { Activity, CheckCircle2, XCircle } from 'lucide-react'
import { useState } from 'react'
import { Button } from '~/components/ui/button'
import { api } from '~/lib/api'

interface HealthCheckResult {
  status: 'healthy' | 'unhealthy'
  message: string
  checked_at: string
}

interface HealthCheckButtonProps {
  connectorId: string
  disabled?: boolean
}

export function HealthCheckButton({ connectorId, disabled }: HealthCheckButtonProps) {
  const [result, setResult] = useState<HealthCheckResult | null>(null)

  const mutation = useMutation({
    mutationFn: () => api.post(`connectors/${connectorId}/health-check`).json<HealthCheckResult>(),
    onSuccess: (data) => setResult(data),
  })

  return (
    <div className="space-y-3">
      <Button
        variant="secondary"
        onClick={() => mutation.mutate()}
        loading={mutation.isPending}
        disabled={disabled}
        className="w-full"
      >
        <Activity className="h-4 w-4" />
        Test Connection
      </Button>

      {result ? (
        <div
          className={`flex items-center gap-2 rounded-lg border p-3 ${
            result.status === 'healthy'
              ? 'border-success/30 bg-success/10 text-success'
              : 'border-error/30 bg-error/10 text-error'
          }`}
        >
          {result.status === 'healthy' ? (
            <CheckCircle2 className="h-4 w-4 shrink-0" />
          ) : (
            <XCircle className="h-4 w-4 shrink-0" />
          )}
          <span className="font-mono text-sm">{result.message}</span>
        </div>
      ) : null}
    </div>
  )
}
