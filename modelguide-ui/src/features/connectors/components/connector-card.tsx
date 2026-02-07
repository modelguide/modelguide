import { Link } from '@tanstack/react-router'
import type { CSSProperties } from 'react'
import { Badge } from '~/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'
import type { CatalogEntry, Connector } from '~/schemas/connectors'

interface ConnectorCardProps {
  connector: Connector
  catalogEntry?: CatalogEntry
  style?: CSSProperties
}

export function ConnectorCard({ connector, catalogEntry, style }: ConnectorCardProps) {
  return (
    <Link to="/connectors/$id" params={{ id: connector.id }}>
      <Card className="card-hover h-full animate-fade-up" style={style}>
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand/10 text-lg font-semibold text-brand">
                {catalogEntry?.iconUrl ? (
                  <img
                    src={catalogEntry.iconUrl}
                    alt={catalogEntry.name}
                    className="h-6 w-6 rounded"
                  />
                ) : (
                  (catalogEntry?.name[0] ?? connector.name[0])
                )}
              </div>
              <div>
                <CardTitle className="text-base">{connector.name}</CardTitle>
                {catalogEntry ? (
                  <p className="text-xs text-fg-secondary">{catalogEntry.name}</p>
                ) : null}
                <p className="font-mono text-xs text-fg-muted">{connector.slug}</p>
              </div>
            </div>
            <Badge variant={connector.isActive ? 'success' : 'default'} dot>
              {connector.isActive ? 'active' : 'inactive'}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          {catalogEntry?.description ? (
            <p className="mb-3 font-sans text-sm text-fg-secondary line-clamp-2">
              {catalogEntry.description}
            </p>
          ) : null}
          {catalogEntry ? <Badge variant="default">{catalogEntry.connectorType}</Badge> : null}
        </CardContent>
      </Card>
    </Link>
  )
}
