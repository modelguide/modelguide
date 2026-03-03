import { Link } from '@tanstack/react-router'
import { ArrowLeft, Plus } from 'lucide-react'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'
import { MutationError } from '~/components/ui/mutation-error'
import { cn } from '~/lib/cn'
import type { SopCreate, SopDetail } from '~/schemas/sops'
import { sidebarTabs, useSopForm } from '../hooks/use-sop-form'
import { SopFormAgentsTab } from './sop-form-agents-tab'
import { SopFormDetailsTab } from './sop-form-details-tab'
import { SopFormMetadataTab } from './sop-form-metadata-tab'
import { SopFormStepRow } from './sop-form-step-row'
import { SopFormTriggerTab } from './sop-form-trigger-tab'

export interface SopFormData extends SopCreate {
  version?: string
}

export interface SopFormProps {
  initialData?: SopDetail
  onSubmit: (data: SopFormData) => void
  isPending: boolean
  error?: Error | null
  submitLabel: string
  backTo: string
}

export function SopForm({
  initialData,
  onSubmit,
  isPending,
  error,
  submitLabel,
  backTo,
}: SopFormProps) {
  const form = useSopForm({ initialData, onSubmit })

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4 animate-fade-up">
        <Link
          to={backTo}
          aria-label="Back to SOPs"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-fg-secondary hover:bg-bg-subtle hover:text-fg-primary transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-fg-primary">
            {form.pageTitle}
          </h1>
          <p className="mt-1 font-sans text-sm text-fg-secondary">{form.pageSubtitle}</p>
        </div>
      </div>

      <form onSubmit={form.handleSubmit} className="grid gap-6 lg:grid-cols-[1fr_340px]">
        {/* Left column — Steps (primary content) */}
        <Card className="min-w-0">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>
                Steps <span className="text-error">*</span>
              </CardTitle>
              <Button type="button" variant="secondary" size="sm" onClick={form.addStep}>
                <Plus className="h-3.5 w-3.5" />
                Add Step
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {form.steps.map((step, index) => (
              <SopFormStepRow
                key={step.id}
                step={step}
                index={index}
                isExpanded={form.expandedStepId === step.id}
                isDragged={form.sortable.draggedId === step.id}
                dropIndicator={form.sortable.dropIndicator}
                connectorTools={form.connectorTools}
                stepsCount={form.steps.length}
                onUpdate={form.updateStep}
                onRemove={form.removeStep}
                onToggleExpand={form.setExpandedStepId}
                setElementRef={form.sortable.setElementRef}
              />
            ))}
          </CardContent>
        </Card>

        {/* Right column — tabbed configuration sidebar */}
        <div className="space-y-4">
          <div className="flex gap-1 rounded-xl bg-bg-subtle p-1">
            {sidebarTabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => form.setSidebarTab(tab.key)}
                className={cn(
                  'flex-1 rounded-lg px-2 py-1.5 text-xs font-medium transition-colors',
                  form.sidebarTab === tab.key
                    ? 'bg-bg-elevated text-fg-primary shadow-sm'
                    : 'text-fg-secondary hover:text-fg-primary',
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {form.sidebarTab === 'details' ? <SopFormDetailsTab form={form} /> : null}
          {form.sidebarTab === 'trigger' ? <SopFormTriggerTab form={form} /> : null}
          {form.sidebarTab === 'metadata' ? <SopFormMetadataTab form={form} /> : null}
          {form.sidebarTab === 'agents' ? <SopFormAgentsTab form={form} /> : null}
        </div>

        {/* Error + Actions — full width below the grid */}
        <MutationError error={error} className="font-sans text-sm text-error lg:col-span-2" />

        <div className="sticky bottom-0 z-10 flex gap-3 border-t border-fg-subtle/10 bg-bg-base/95 py-4 backdrop-blur-sm lg:col-span-2">
          <Button type="submit" loading={isPending} disabled={!form.isValid}>
            {submitLabel}
          </Button>
          <Link to={backTo}>
            <Button variant="secondary" type="button">
              Cancel
            </Button>
          </Link>
        </div>
      </form>
    </div>
  )
}
