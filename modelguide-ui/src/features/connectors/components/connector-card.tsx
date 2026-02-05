import { Link } from '@tanstack/react-router'
import { CheckCircle2, Settings, XCircle } from 'lucide-react'
import type { CSSProperties } from 'react'
import { Badge } from '~/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'
import type { Connector } from '~/schemas/connectors'

interface ConnectorCardProps {
  connector: Connector
  style?: CSSProperties
}

export function ConnectorCard({ connector, style }: ConnectorCardProps) {
  return (
    <Link to="/connectors/$id" params={{ id: connector.id }}>
      <Card
        className="h-full animate-fade-up transition-colors hover:border-brand/50"
        style={style}
      >
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand/10 text-lg font-semibold text-brand">
                {connector.name[0]}
              </div>
              <div>
                <CardTitle className="text-base">{connector.name}</CardTitle>
                <p className="font-mono text-xs text-fg-muted">{connector.slug}</p>
              </div>
            </div>
            <Badge variant={connector.is_configured ? 'success' : 'warning'} dot>
              {connector.is_configured ? 'configured' : 'setup needed'}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <p className="mb-4 font-sans text-sm text-fg-secondary line-clamp-2">
            {connector.description}
          </p>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1 text-fg-muted">
              <Settings className="h-3.5 w-3.5" />
              <span className="text-xs">{connector.tools.length} tools</span>
            </div>
            <div className="flex items-center gap-1">
              {connector.is_configured ? (
                <CheckCircle2 className="h-4 w-4 text-success" />
              ) : (
                <XCircle className="h-4 w-4 text-warning" />
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  )
}
