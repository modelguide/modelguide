import { Layers } from 'lucide-react'
import { EmptyState } from '~/components/ui/empty-state'
import type { SopTemplate } from '~/schemas/sops'
import { TemplateCard } from './template-card'

interface TemplatesGridProps {
  templates: SopTemplate[]
  showForkButton?: boolean
}

export function TemplatesGrid({ templates, showForkButton }: TemplatesGridProps) {
  if (templates.length === 0) {
    return (
      <EmptyState
        icon={Layers}
        title="No templates available"
        description="SOP templates will appear here when they are added to the catalog"
      />
    )
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {templates.map((template, index) => (
        <TemplateCard
          key={template.id}
          template={template}
          showForkButton={showForkButton}
          style={{ animationDelay: `${index * 50}ms` }}
        />
      ))}
    </div>
  )
}
