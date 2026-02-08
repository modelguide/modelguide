import { Spinner } from '~/components/ui/spinner'
import type { CatalogEntry, Connector } from '~/schemas/connectors'
import { ConnectorCard } from './connector-card'

interface ConnectorsGridProps {
  connectors: Connector[]
  catalogMap?: Map<string, CatalogEntry>
  isLoading: boolean
}

export function ConnectorsGrid({ connectors, catalogMap, isLoading }: ConnectorsGridProps) {
  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size="lg" />
      </div>
    )
  }

  if (connectors.length === 0) {
    return null
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {connectors.map((connector, index) => (
        <ConnectorCard
          key={connector.id}
          connector={connector}
          catalogEntry={catalogMap?.get(connector.connectorCatalogId)}
          style={{ animationDelay: `${index * 50}ms` }}
        />
      ))}
    </div>
  )
}
