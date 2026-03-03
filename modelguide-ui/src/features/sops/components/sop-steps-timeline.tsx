import { Link } from '@tanstack/react-router'
import { AlertTriangle, ExternalLink, Terminal } from 'lucide-react'
import { Tooltip } from '~/components/ui/tooltip'
import { cn } from '~/lib/cn'
import type { SopStep, StepWarning } from '~/schemas/sops'

interface SopStepsTimelineProps {
  steps: SopStep[]
  warnings?: StepWarning[]
  className?: string
}

/** Parse a resolvedName like "glowbox_store_get_order" into connector + tool parts. */
function parseResolvedName(resolvedName: string) {
  const firstUnderscore = resolvedName.indexOf('_')
  if (firstUnderscore === -1) return { connector: resolvedName, tool: resolvedName }
  return {
    connector: resolvedName.slice(0, firstUnderscore),
    tool: resolvedName.slice(firstUnderscore + 1),
  }
}

function ToolPill({
  tool,
  hasWarning,
}: { tool: NonNullable<SopStep['tool']>; hasWarning: boolean }) {
  // Resolved name for org-scoped SOPs, or catalogSlug + toolSlug for templates
  if (tool.resolvedName) {
    const { connector, tool: toolName } = parseResolvedName(tool.resolvedName)
    return (
      <ResolvedToolPill
        connector={connector}
        toolName={toolName}
        tool={tool}
        hasWarning={hasWarning}
      />
    )
  }

  if (tool.toolSlug) {
    const catalog = tool.catalogSlug ?? 'catalog'
    return (
      <Tooltip
        content={
          <div className="flex flex-col gap-1 whitespace-nowrap">
            <span className="text-fg-muted">
              Catalog: <span className="text-fg-primary">{catalog}</span>
            </span>
            <span className="text-fg-muted">
              Tool: <span className="text-fg-primary font-mono">{tool.toolSlug}</span>
            </span>
            <span className="text-[10px] text-fg-muted">Template tool — mapped on fork</span>
          </div>
        }
        side="bottom"
        align="start"
      >
        <span
          className={cn(
            'mt-2 inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 font-mono text-xs ring-1 transition-colors',
            'bg-amber-500/[0.08] text-amber-400 ring-amber-500/15',
          )}
        >
          <Terminal className="h-3 w-3 shrink-0" />
          <span className="text-fg-muted">{catalog}_</span>
          {tool.toolSlug}
        </span>
      </Tooltip>
    )
  }

  return null
}

function ResolvedToolPill({
  connector,
  toolName,
  tool,
  hasWarning,
}: {
  connector: string
  toolName: string
  tool: NonNullable<SopStep['tool']>
  hasWarning: boolean
}) {
  const pill = (
    <span
      className={cn(
        'mt-2 inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 font-mono text-xs ring-1 transition-colors',
        hasWarning
          ? 'bg-error/[0.08] text-error/90 ring-error/20'
          : 'bg-violet-500/[0.08] text-violet-400 ring-violet-500/15 hover:bg-violet-500/[0.14]',
      )}
    >
      <Terminal className="h-3 w-3 shrink-0" />
      <span className="text-fg-muted">{connector}_</span>
      {toolName}
      {tool.connectorId ? <ExternalLink className="ml-0.5 h-2.5 w-2.5 opacity-50" /> : null}
    </span>
  )

  const tooltipContent = (
    <div className="flex flex-col gap-1 whitespace-nowrap">
      <span className="text-fg-muted">
        Connector: <span className="text-fg-primary">{connector}</span>
      </span>
      <span className="text-fg-muted">
        Tool: <span className="text-fg-primary font-mono">{toolName}</span>
      </span>
      {tool.connectorId ? (
        <span className="text-[10px] text-fg-muted">Click to open connector</span>
      ) : null}
    </div>
  )

  if (tool.connectorId) {
    return (
      <Tooltip content={tooltipContent} side="bottom" align="start">
        <Link to="/connectors/$id" params={{ id: tool.connectorId }}>
          {pill}
        </Link>
      </Tooltip>
    )
  }

  return (
    <Tooltip content={tooltipContent} side="bottom" align="start">
      {pill}
    </Tooltip>
  )
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
              {step.tool?.resolvedName || step.tool?.toolSlug ? (
                <ToolPill tool={step.tool} hasWarning={!!warning} />
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
