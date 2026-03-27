import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Button } from '~/components/ui/button'
import { Dialog, DialogFooter } from '~/components/ui/dialog'
import { Select } from '~/components/ui/select'
import { api } from '~/lib/api'
import type { EvalSuiteRun } from '~/schemas/eval-suites'
import { PROMPT_SOURCE_LABELS } from '~/schemas/eval-suites'
import type { EvalSuiteTestCase } from '~/schemas/eval-suites'

export interface SimulateRunDialogProps {
  open: boolean
  onClose: () => void
  suiteId: string
  testCases: EvalSuiteTestCase[]
  onSuccess?: () => void
}

export function SimulateRunDialog({
  open,
  onClose,
  suiteId,
  testCases,
  onSuccess,
}: SimulateRunDialogProps) {
  const queryClient = useQueryClient()

  const [promptSource, setPromptSource] = useState('compiled')
  const [selectedTestCaseIds, setSelectedTestCaseIds] = useState<Set<string>>(
    () => new Set(testCases.map((tc) => tc.id)),
  )

  const allSelected = testCases.length > 0 && selectedTestCaseIds.size === testCases.length

  const simulateMutation = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = { promptSource }
      if (!allSelected && selectedTestCaseIds.size > 0) {
        body.testCaseIds = Array.from(selectedTestCaseIds)
      }
      return api
        .post(`eval-suites/${suiteId}/simulate-and-run`, { json: body })
        .json<EvalSuiteRun>()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['eval-suites', suiteId, 'runs'] })
      onClose()
      setPromptSource('compiled')
      setSelectedTestCaseIds(new Set(testCases.map((tc) => tc.id)))
      onSuccess?.()
    },
  })

  const canSubmit = testCases.length === 0 || selectedTestCaseIds.size > 0

  const toggleTestCase = (id: string) => {
    setSelectedTestCaseIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const toggleAllTestCases = () => {
    if (allSelected) {
      setSelectedTestCaseIds(new Set())
    } else {
      setSelectedTestCaseIds(new Set(testCases.map((tc) => tc.id)))
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Simulate & Run"
      description="Generate synthetic sessions from test cases and evaluate them against this suite's evaluators."
    >
      <div className="space-y-4">
        <Select
          label="Prompt Source"
          value={promptSource}
          onChange={(e) => setPromptSource(e.target.value)}
        >
          {Object.entries(PROMPT_SOURCE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>

        {/* Test case selection */}
        {testCases.length > 0 ? (
          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs font-medium text-fg-muted">
                Test Cases ({selectedTestCaseIds.size}/{testCases.length})
              </p>
              <button
                type="button"
                onClick={toggleAllTestCases}
                className="text-xs text-brand-400 hover:text-brand-300"
              >
                {allSelected ? 'Deselect all' : 'Select all'}
              </button>
            </div>
            <div className="max-h-40 space-y-0.5 overflow-y-auto rounded-lg border border-fg-subtle/10 bg-bg-base p-1.5">
              {testCases.map((tc) => (
                <label
                  key={tc.id}
                  className="flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-xs transition-colors hover:bg-bg-subtle/40"
                >
                  <input
                    type="checkbox"
                    checked={selectedTestCaseIds.has(tc.id)}
                    onChange={() => toggleTestCase(tc.id)}
                    className="h-3.5 w-3.5 rounded border-fg-subtle/30 bg-bg-subtle text-brand-500 focus:ring-brand-500/30"
                  />
                  <span className="flex-1 text-fg-secondary">{tc.name}</span>
                  <span className="text-fg-muted">{tc.source}</span>
                </label>
              ))}
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-fg-subtle/10 bg-bg-base p-4 text-center text-xs text-fg-muted">
            No test cases defined. Add test cases to the suite first.
          </div>
        )}

        {simulateMutation.error ? (
          <p className="text-xs text-error">Failed to start simulation. Please try again.</p>
        ) : null}
      </div>

      <DialogFooter>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button
          onClick={() => simulateMutation.mutate()}
          disabled={!canSubmit}
          loading={simulateMutation.isPending}
        >
          Simulate & Run
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
