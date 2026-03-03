import { Link } from '@tanstack/react-router'
import { ArrowRight, GitFork, Layers } from 'lucide-react'
import type { CSSProperties } from 'react'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import type { SopTemplate } from '~/schemas/sops'

interface TemplateCardProps {
  template: SopTemplate
  showForkButton?: boolean
  style?: CSSProperties
}

export function TemplateCard({ template, showForkButton, style }: TemplateCardProps) {
  return (
    <div
      className="group flex flex-col rounded-2xl border border-fg-subtle/15 bg-bg-elevated p-5 transition-all hover:border-fg-subtle/30 animate-fade-up"
      style={style}
    >
      <div className="mb-3 flex items-start justify-between">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-500/10">
          <Layers className="h-5 w-5 text-violet-400" />
        </div>
        <Badge variant="default">v{template.version}</Badge>
      </div>

      <h3 className="font-display text-base font-semibold text-fg-primary">{template.name}</h3>

      {template.description ? (
        <p className="mt-1.5 line-clamp-2 font-sans text-sm text-fg-secondary">
          {template.description}
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-1.5">
        {template.catalogSlugs.map((slug) => (
          <Badge key={slug} variant="brand">
            {slug}
          </Badge>
        ))}
      </div>

      <div className="mt-4 flex items-center justify-between border-t border-fg-subtle/10 pt-3">
        <span className="text-xs text-fg-muted">
          {template.definition.steps.length} step
          {template.definition.steps.length !== 1 ? 's' : ''}
        </span>
        {showForkButton ? (
          <Link to="/sops/fork/$templateId" params={{ templateId: template.id }}>
            <Button variant="secondary" size="sm">
              <GitFork className="h-3.5 w-3.5" />
              Use Template
              <ArrowRight className="h-3 w-3" />
            </Button>
          </Link>
        ) : null}
      </div>
    </div>
  )
}
