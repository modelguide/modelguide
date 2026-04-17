import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Dialog, DialogFooter } from '~/components/ui/dialog'
import { api } from '~/lib/api'
import type { EvalSuiteAssertion } from '~/schemas/eval-suites'
import { EvalConfigPickerDialog } from './eval-config-picker-dialog'

export interface EvaluatorsPanelProps {
  evaluators: EvalSuiteAssertion[]
  suiteId: string
  isAdmin?: boolean
}

export function EvaluatorsPanel({ evaluators, suiteId, isAdmin = false }: EvaluatorsPanelProps) {
  const queryClient = useQueryClient()
  const [showPicker, setShowPicker] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<EvalSuiteAssertion | null>(null)

  const addMutation = useMutation({
    mutationFn: (data: { evalConfigId: string; name: string }) =>
      api.post(`eval-suites/${suiteId}/evaluators`, { json: data }).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['eval-suites', suiteId] })
      setShowPicker(false)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (evaluatorId: string) =>
      api.delete(`eval-suites/${suiteId}/evaluators/${evaluatorId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['eval-suites', suiteId] })
      setDeleteTarget(null)
    },
  })

  if (evaluators.length === 0 && !isAdmin) {
    return (
      <div className="rounded-lg border border-fg-subtle/10 bg-bg-elevated px-6 py-12 text-center">
        <p className="text-sm text-fg-muted">No evaluators yet</p>
      </div>
    )
  }

  return (
    <>
      <div className="space-y-3">
        {/* Header with add button */}
        {isAdmin ? (
          <div className="flex items-center justify-end">
            <Button variant="secondary" size="sm" onClick={() => setShowPicker(true)}>
              <Plus className="h-3.5 w-3.5" />
              Add evaluator
            </Button>
          </div>
        ) : null}

        {evaluators.length === 0 ? (
          <div className="rounded-lg border border-fg-subtle/10 bg-bg-elevated px-6 py-12 text-center">
            <p className="text-sm text-fg-muted">No evaluators yet</p>
          </div>
        ) : (
          <div className="space-y-0.5 rounded-xl border border-fg-subtle/10 bg-bg-elevated p-1.5">
            {evaluators.map((evaluator) => (
              <div
                key={evaluator.id}
                className="group flex items-center gap-2 rounded-md px-3 py-2.5 text-sm transition-colors hover:bg-bg-subtle/40"
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
                {isAdmin ? (
                  <button
                    type="button"
                    onClick={() => setDeleteTarget(evaluator)}
                    className="rounded p-1 text-fg-muted opacity-0 transition-all hover:bg-error/10 hover:text-error group-hover:opacity-100"
                    title="Delete evaluator"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Eval config picker dialog */}
      <EvalConfigPickerDialog
        open={showPicker}
        onClose={() => setShowPicker(false)}
        onSelect={(config) => {
          addMutation.mutate({ evalConfigId: config.id, name: config.name })
        }}
      />

      {/* Delete confirmation */}
      <Dialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Delete Evaluator"
        description={`Remove "${deleteTarget?.name}" from this suite? Any case-level exclude overrides referencing this evaluator will also be cleaned up.`}
      >
        {deleteMutation.error ? (
          <p className="mb-3 text-xs text-error">Failed to delete evaluator. Please try again.</p>
        ) : null}
        <DialogFooter>
          <Button variant="secondary" onClick={() => setDeleteTarget(null)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
            loading={deleteMutation.isPending}
          >
            Delete
          </Button>
        </DialogFooter>
      </Dialog>
    </>
  )
}
