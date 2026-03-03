import { AlertTriangle, Terminal } from 'lucide-react'
import { cn } from '~/lib/cn'
import type { SopStep, StepWarning } from '~/schemas/sops'

interface SopStepsTimelineProps {
  steps: SopStep[]
  warnings?: StepWarning[]
  className?: string
}

export function SopStepsTimeline({ steps, warnings = [], className }: SopStepsTimelineProps) {
  const warningMap = new Map(warnings.map((w) => [w.stepId, w.message]))
  const sorted = [...steps].sort((a, b) => a.order - b.order)

  return (
    <div className={cn('relative', className)}>
      {sorted.map((step, index) => {
        const isLast = index === sorted.length - 1
        const warning = warningMap.get(step.id)

        return (
          <div key={step.id} className="relative flex gap-4">
            {/* Timeline connector */}
            <div className="flex flex-col items-center">
              {/* Step number circle */}
              <div
                className={cn(
                  'relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                  step.required
                    ? 'bg-teal/15 text-teal ring-1 ring-teal/20'
                    : 'bg-bg-subtle text-fg-muted ring-1 ring-fg-subtle/15',
                )}
              >
                {step.order}
              </div>
              {/* Vertical line */}
              {!isLast ? (
                <div
                  className={cn(
                    'w-px flex-1 min-h-4',
                    step.required
                      ? 'bg-gradient-to-b from-teal/30 to-teal/5'
                      : 'bg-gradient-to-b from-fg-subtle/20 to-fg-subtle/5',
                  )}
                />
              ) : null}
            </div>

            {/* Step content */}
            <div className={cn('flex-1 pb-6', isLast && 'pb-0')}>
              {/* Header row */}
              <div className="flex items-center gap-2 mb-1.5">
                <span
                  className={cn(
                    'rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider',
                    step.required ? 'bg-teal/10 text-teal' : 'bg-bg-subtle text-fg-muted',
                  )}
                >
                  {step.required ? 'Required' : 'Optional'}
                </span>
                {warning ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-warning/10 px-2 py-0.5 text-[10px] font-medium text-warning">
                    <AlertTriangle className="h-2.5 w-2.5" />
                    {warning}
                  </span>
                ) : null}
              </div>

              {/* Instruction */}
              <p className="text-sm text-fg-primary leading-relaxed">{step.instruction}</p>

              {/* Tool reference */}
              {step.tool?.resolvedName ? (
                <span className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-brand-500/[0.06] px-2.5 py-1 font-mono text-xs text-brand-400/80 ring-1 ring-brand-500/10">
                  <Terminal className="h-3 w-3" />
                  {step.tool.resolvedName}
                </span>
              ) : null}

              {/* Notes */}
              {step.notes ? (
                <p className="mt-2 text-xs italic text-fg-muted">{step.notes}</p>
              ) : null}
            </div>
          </div>
        )
      })}
    </div>
  )
}
