import { Badge } from '~/components/ui/badge'
import type { EvalSuiteAssertion } from '~/schemas/eval-suites'

export interface EvaluatorsPanelProps {
  evaluators: EvalSuiteAssertion[]
}

export function EvaluatorsPanel({ evaluators }: EvaluatorsPanelProps) {
  if (evaluators.length === 0) {
    return (
      <div className="rounded-lg border border-fg-subtle/10 bg-bg-elevated px-6 py-12 text-center">
        <p className="text-sm text-fg-muted">No evaluators yet</p>
      </div>
    )
  }

  return (
    <div className="space-y-0.5 rounded-xl border border-fg-subtle/10 bg-bg-elevated p-1.5">
      {evaluators.map((evaluator) => (
        <div
          key={evaluator.id}
          className="flex items-center gap-2 rounded-md px-3 py-2.5 text-sm transition-colors hover:bg-bg-subtle/40"
        >
          <span className="flex-1 font-mono text-xs text-fg-secondary">{evaluator.name}</span>
          {evaluator.tags?.length > 0 ? (
            <div className="flex gap-1">
              {evaluator.tags.map((tag) => (
                <Badge key={tag} variant="default">
                  {tag}
                </Badge>
              ))}
            </div>
          ) : null}
          <Badge variant={evaluator.source === 'auto' ? 'info' : 'default'}>
            {evaluator.source}
          </Badge>
          {evaluator.required ? (
            <Badge variant="warning">required</Badge>
          ) : (
            <span className="text-xs text-fg-muted">optional</span>
          )}
          {evaluator.sopStepId ? (
            <span className="text-[10px] text-fg-muted">step: {evaluator.sopStepId}</span>
          ) : null}
        </div>
      ))}
    </div>
  )
}
