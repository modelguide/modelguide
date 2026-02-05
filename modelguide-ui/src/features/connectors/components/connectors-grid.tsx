import { Spinner } from '~/components/ui/spinner'
import type { Connector } from '~/schemas/connectors'
import { ConnectorCard } from './connector-card'

interface ConnectorsGridProps {
  connectors: Connector[]
  isLoading: boolean
}

export function ConnectorsGrid({ connectors, isLoading }: ConnectorsGridProps) {
  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size="lg" />
      </div>
    )
  }

  if (connectors.length === 0) {
    return (
      <div className="rounded-lg border border-fg-subtle/20 bg-bg-elevated p-12 text-center">
        <p className="font-mono text-sm text-fg-secondary">No connectors available</p>
      </div>
    )
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {connectors.map((connector, index) => (
        <ConnectorCard
          key={connector.id}
          connector={connector}
          style={{ animationDelay: `${index * 50}ms` }}
        />
      ))}
    </div>
  )
}
