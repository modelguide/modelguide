import { ChevronDown, GripVertical, Terminal, Trash2 } from 'lucide-react'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import type { DropIndicator } from '~/hooks/use-sortable-list'
import { cn } from '~/lib/cn'
import type { ConnectorWithTools, StepForm } from '../hooks/use-sop-form'

interface SopFormStepRowProps {
  step: StepForm
  index: number
  isExpanded: boolean
  isDragged: boolean
  dropIndicator: DropIndicator | null
  connectorTools: ConnectorWithTools[] | undefined
  stepsCount: number
  onUpdate: (index: number, update: Partial<StepForm>) => void
  onRemove: (index: number) => void
  onToggleExpand: (stepId: string | null) => void
  setElementRef: (id: string, el: HTMLElement | null) => void
}

export function SopFormStepRow({
  step,
  index,
  isExpanded,
  isDragged,
  dropIndicator,
  connectorTools,
  stepsCount,
  onUpdate,
  onRemove,
  onToggleExpand,
  setElementRef,
}: SopFormStepRowProps) {
  const showDropTop = dropIndicator?.id === step.id && dropIndicator.edge === 'top'
  const showDropBottom = dropIndicator?.id === step.id && dropIndicator.edge === 'bottom'

  return (
    <div className="relative">
      {showDropTop ? (
        <div className="absolute -top-1 left-2 right-2 h-0.5 rounded-full bg-brand-500 z-10" />
      ) : null}
      <div
        ref={(el) => setElementRef(step.id, el)}
        className={cn(
          'rounded-lg border bg-bg-base transition-all cursor-grab active:cursor-grabbing',
          isDragged && 'opacity-40',
          isExpanded
            ? 'border-brand-500/30 ring-1 ring-brand-500/10'
            : 'border-fg-subtle/15 hover:border-fg-subtle/30',
        )}
      >
        {/* Step row: drag | number | instruction | badges | actions */}
        <div className="flex items-start gap-1.5 px-2 py-1.5">
          <div className="mt-1 shrink-0 rounded p-0.5 text-fg-muted">
            <GripVertical className="h-3.5 w-3.5" />
          </div>
          <Badge className="mt-1 h-5 w-5 shrink-0 justify-center rounded-full px-0 py-0 text-[10px]">
            {index + 1}
          </Badge>
          <textarea
            value={step.instruction}
            onChange={(e) => {
              onUpdate(index, { instruction: e.target.value })
              if (isExpanded) {
                const el = e.target
                el.style.height = 'auto'
                el.style.height = `${el.scrollHeight}px`
              }
            }}
            onFocus={() => {
              if (!isExpanded) onToggleExpand(step.id)
            }}
            placeholder="What should the agent do in this step?"
            rows={1}
            className={cn(
              'min-w-0 flex-1 resize-none bg-transparent px-1.5 py-0.5 text-sm text-fg-primary placeholder:text-fg-muted',
              'rounded outline-none transition-colors',
              'hover:bg-bg-subtle/50 focus:bg-bg-subtle focus:ring-1 focus:ring-brand-500/30',
              !isExpanded && 'overflow-hidden whitespace-nowrap text-ellipsis',
            )}
            ref={(el) => {
              if (!el) return
              if (isExpanded) {
                el.style.height = 'auto'
                el.style.height = `${el.scrollHeight}px`
              } else {
                el.style.height = ''
              }
            }}
          />
          <div className="mt-0.5 flex shrink-0 items-center gap-1">
            {/* Tool picker — badge with icon + label, hidden select overlay */}
            <div className="relative">
              <Badge
                variant={step.connectorToolId ? 'info' : 'default'}
                className="flex items-center gap-1 px-1.5 py-0 text-[10px]"
              >
                <Terminal className="h-3 w-3" />
                Tool
              </Badge>
              <select
                value={step.connectorToolId}
                onChange={(e) => onUpdate(index, { connectorToolId: e.target.value })}
                className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                title="Select connector tool"
              >
                <option value="">No tool</option>
                {connectorTools?.map((ct) => (
                  <optgroup key={ct.connector.id} label={ct.connector.name}>
                    {ct.tools.map((tool) => (
                      <option key={tool.id} value={tool.id} disabled={!tool.isActive}>
                        {ct.connector.slug}_{tool.slug}
                        {!tool.isActive ? ' (inactive)' : ''}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onUpdate(index, { required: !step.required })}
              className={cn(
                'h-auto rounded-full px-1.5 py-0.5 text-[10px] font-medium',
                step.required
                  ? 'bg-success-muted text-success hover:bg-success-muted/80'
                  : 'bg-bg-subtle text-fg-muted hover:bg-bg-subtle/80',
              )}
            >
              {step.required ? 'Req' : 'Opt'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => onToggleExpand(isExpanded ? null : step.id)}
              className="h-6 w-6"
            >
              <ChevronDown
                className={cn('h-3.5 w-3.5 transition-transform', isExpanded && 'rotate-180')}
              />
            </Button>
            {stepsCount > 1 ? (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => onRemove(index)}
                className="h-6 w-6 text-fg-muted hover:text-error"
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            ) : null}
          </div>
        </div>

        {/* Expanded: notes */}
        {isExpanded ? (
          <div className="px-2 pb-2 pl-[52px]">
            <input
              value={step.notes}
              onChange={(e) => onUpdate(index, { notes: e.target.value })}
              placeholder="Notes..."
              className="w-full bg-transparent px-1.5 py-0.5 text-xs text-fg-secondary placeholder:text-fg-muted rounded outline-none transition-colors hover:bg-bg-subtle/50 focus:bg-bg-subtle focus:ring-1 focus:ring-brand-500/30"
            />
          </div>
        ) : null}
      </div>
      {showDropBottom ? (
        <div className="absolute -bottom-1 left-2 right-2 h-0.5 rounded-full bg-brand-500 z-10" />
      ) : null}
    </div>
  )
}
