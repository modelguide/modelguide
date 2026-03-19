import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Button } from '~/components/ui/button'
import { Dialog, DialogFooter } from '~/components/ui/dialog'
import { Input } from '~/components/ui/input'
import { Select } from '~/components/ui/select'
import { api } from '~/lib/api'
import type { EvalSuiteRun } from '~/schemas/eval-suites'
import { PROMPT_SOURCE_LABELS } from '~/schemas/eval-suites'

export interface RunSuiteDialogProps {
  open: boolean
  onClose: () => void
  suiteId: string
  onSuccess?: () => void
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function RunSuiteDialog({ open, onClose, suiteId, onSuccess }: RunSuiteDialogProps) {
  const queryClient = useQueryClient()

  const [sessionId, setSessionId] = useState('')
  const [promptSource, setPromptSource] = useState('compiled')

  const runMutation = useMutation({
    mutationFn: () =>
      api
        .post(`eval-suites/${suiteId}/run`, { json: { sessionId, promptSource } })
        .json<EvalSuiteRun>(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['eval-suites', suiteId, 'runs'] })
      onClose()
      setSessionId('')
      setPromptSource('compiled')
      onSuccess?.()
    },
  })

  const isValidUuid = UUID_RE.test(sessionId.trim())
  const canSubmit = isValidUuid

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Run Eval Suite"
      description="Evaluate a session against this suite's test cases and assertions."
    >
      <div className="space-y-4">
        <div>
          <Input
            label="Session ID"
            placeholder="Paste a session UUID…"
            value={sessionId}
            onChange={(e) => setSessionId(e.target.value)}
          />
          {sessionId.trim() !== '' && !isValidUuid ? (
            <p className="mt-1 text-xs text-warning">Enter a valid UUID</p>
          ) : null}
        </div>

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

        {runMutation.error ? (
          <p className="text-xs text-error">Failed to start run. Please try again.</p>
        ) : null}
      </div>

      <DialogFooter>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button
          onClick={() => runMutation.mutate()}
          disabled={!canSubmit}
          loading={runMutation.isPending}
        >
          Run Suite
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
