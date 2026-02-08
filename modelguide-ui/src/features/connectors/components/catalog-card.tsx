import { Link } from '@tanstack/react-router'
import { Plus, Settings } from 'lucide-react'
import type { CSSProperties } from 'react'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'
import { cn } from '~/lib/cn'
import type { CatalogEntry } from '~/schemas/connectors'

interface CatalogCardProps {
  entry: CatalogEntry
  /** Dashed border variant for the preview section */
  dashed?: boolean
  /** Compact variant — smaller card without description */
  compact?: boolean
  /** Click-to-select mode for catalog picker on new page */
  onSelect?: (entry: CatalogEntry) => void
  /** Show "+ Add" button (admin only) */
  showAddButton?: boolean
  style?: CSSProperties
}

export function CatalogCard({
  entry,
  dashed,
  compact,
  onSelect,
  showAddButton = true,
  style,
}: CatalogCardProps) {
  const content = compact ? (
    <CompactCard entry={entry} dashed={dashed} showAddButton={showAddButton} style={style} />
  ) : (
    <FullCard
      entry={entry}
      dashed={dashed}
      onSelect={onSelect}
      showAddButton={showAddButton}
      style={style}
    />
  )

  if (onSelect) {
    return (
      <button type="button" onClick={() => onSelect(entry)} className="w-full text-left">
        {content}
      </button>
    )
  }

  return content
}

function CompactCard({
  entry,
  dashed,
  showAddButton,
  style,
}: {
  entry: CatalogEntry
  dashed?: boolean
  showAddButton: boolean
  style?: CSSProperties
}) {
  return (
    <Card
      className={cn(
        'animate-fade-up transition-all duration-200 hover:border-fg-subtle/30',
        dashed && 'border-dashed',
      )}
      style={style}
    >
      <div className="flex items-center gap-3 p-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-500/10 text-sm font-semibold text-brand-500">
          {entry.iconUrl ? (
            <img src={entry.iconUrl} alt={entry.name} className="h-5 w-5 rounded" />
          ) : (
            entry.name[0]
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-fg-primary">{entry.name}</p>
          <div className="flex items-center gap-2">
            <span className="text-xs text-fg-muted">{entry.connectorType}</span>
            <span className="text-fg-subtle">&middot;</span>
            <span className="text-xs text-fg-muted">
              {entry.tools.length} {entry.tools.length === 1 ? 'tool' : 'tools'}
            </span>
          </div>
        </div>
        {showAddButton ? (
          <Link to="/connectors/new" search={{ connectorCatalogId: entry.id }}>
            <Button size="icon-sm" variant="secondary">
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </Link>
        ) : null}
      </div>
    </Card>
  )
}

function FullCard({
  entry,
  dashed,
  onSelect,
  showAddButton,
  style,
}: {
  entry: CatalogEntry
  dashed?: boolean
  onSelect?: (entry: CatalogEntry) => void
  showAddButton: boolean
  style?: CSSProperties
}) {
  return (
    <Card
      className={cn(
        'card-hover h-full animate-fade-up',
        dashed && 'border-dashed',
        onSelect && 'cursor-pointer',
      )}
      style={style}
    >
      <CardHeader className="pb-2">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-500/10 text-lg font-semibold text-brand-500">
            {entry.iconUrl ? (
              <img src={entry.iconUrl} alt={entry.name} className="h-6 w-6 rounded" />
            ) : (
              entry.name[0]
            )}
          </div>
          <div>
            <CardTitle className="text-base">{entry.name}</CardTitle>
            <Badge variant="default" className="mt-1">
              {entry.connectorType}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {entry.description ? (
          <p className="mb-4 font-sans text-sm text-fg-secondary line-clamp-2">
            {entry.description}
          </p>
        ) : null}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-fg-muted">
            <Settings className="h-3.5 w-3.5" />
            <span className="text-xs">
              {entry.tools.length} {entry.tools.length === 1 ? 'tool' : 'tools'}
            </span>
          </div>
          {showAddButton && !onSelect ? (
            <Link to="/connectors/new" search={{ connectorCatalogId: entry.id }}>
              <Button size="sm" variant="secondary">
                <Plus className="h-3.5 w-3.5" />
                Add
              </Button>
            </Link>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}
