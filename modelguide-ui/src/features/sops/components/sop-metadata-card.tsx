import { AlertTriangle, Clock, Hash, Tag } from 'lucide-react'
import { Badge } from '~/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'
import type { SopMetadata } from '~/schemas/sops'

interface SopMetadataCardProps {
  metadata: SopMetadata
}

export function SopMetadataCard({ metadata }: SopMetadataCardProps) {
  const hasTags = metadata.tags && metadata.tags.length > 0
  const hasEscalation = metadata.escalationTriggers && metadata.escalationTriggers.length > 0
  const hasAny = metadata.reasonCode || hasTags || metadata.estimatedDuration || hasEscalation

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Hash className="h-4 w-4" />
          Metadata
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!hasAny ? (
          <p className="font-sans text-sm text-fg-muted">No metadata defined</p>
        ) : (
          <dl className="space-y-4">
            {hasTags ? (
              <div>
                <dt className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-fg-muted">
                  <Tag className="h-3 w-3" />
                  Tags
                </dt>
                <dd className="flex flex-wrap gap-1.5">
                  {metadata.tags?.map((tag) => (
                    <Badge key={tag} variant="default">
                      {tag}
                    </Badge>
                  ))}
                </dd>
              </div>
            ) : null}

            {metadata.reasonCode ? (
              <div>
                <dt className="text-xs font-medium text-fg-muted">Reason Code</dt>
                <dd className="mt-1 font-mono text-sm text-fg-secondary">{metadata.reasonCode}</dd>
              </div>
            ) : null}

            {metadata.estimatedDuration ? (
              <div>
                <dt className="mb-1 flex items-center gap-1.5 text-xs font-medium text-fg-muted">
                  <Clock className="h-3 w-3" />
                  Estimated Duration
                </dt>
                <dd className="text-sm text-fg-secondary">{metadata.estimatedDuration}</dd>
              </div>
            ) : null}

            {hasEscalation ? (
              <div>
                <dt className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-fg-muted">
                  <AlertTriangle className="h-3 w-3" />
                  Escalation Triggers
                </dt>
                <dd>
                  <ul className="space-y-1">
                    {metadata.escalationTriggers?.map((trigger) => (
                      <li
                        key={trigger}
                        className="flex items-start gap-1.5 text-sm text-fg-secondary"
                      >
                        <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-warning" />
                        {trigger}
                      </li>
                    ))}
                  </ul>
                </dd>
              </div>
            ) : null}
          </dl>
        )}
      </CardContent>
    </Card>
  )
}
