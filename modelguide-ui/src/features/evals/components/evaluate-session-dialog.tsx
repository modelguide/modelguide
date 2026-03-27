import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Button } from '~/components/ui/button'
import { Dialog, DialogFooter } from '~/components/ui/dialog'
import { Input } from '~/components/ui/input'
import { Select } from '~/components/ui/select'
import { api } from '~/lib/api'
import { cn } from '~/lib/cn'
import type { PaginatedResponse } from '~/lib/pagination'
import { formatDate, formatDuration } from '~/lib/utils'
import type { EvalSuiteRun } from '~/schemas/eval-suites'
import { PROMPT_SOURCE_LABELS } from '~/schemas/eval-suites'
import type { SessionListItem } from '~/schemas/sessions'

export interface EvaluateSessionDialogProps {
  open: boolean
  onClose: () => void
  suiteId: string
  agentId?: string
  onSuccess?: () => void
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function EvaluateSessionDialog({
  open,
  onClose,
  suiteId,
  agentId,
  onSuccess,
}: EvaluateSessionDialogProps) {
  const queryClient = useQueryClient()

  const [sessionId, setSessionId] = useState('')
  const [promptSource, setPromptSource] = useState('compiled')

  const { data: sessionsData, isLoading: sessionsLoading } = useQuery({
    queryKey: ['sessions', { agentId, pageSize: 10 }],
    queryFn: () =>
      api
        .get('sessions', { searchParams: { agentId: agentId ?? '', pageSize: 10 } })
        .json<PaginatedResponse<SessionListItem>>(),
    enabled: open && !!agentId,
  })

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

  const recentSessions = sessionsData?.data ?? []

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Evaluate Session"
      description="Pick an existing live session to evaluate against this suite's evaluators."
    >
      <div className="space-y-4">
        {/* Recent sessions picker */}
        {agentId && recentSessions.length > 0 ? (
          <div>
            <p className="mb-2 text-xs font-medium text-fg-muted">Recent Sessions</p>
            <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-fg-subtle/10 bg-bg-base p-1.5">
              {recentSessions.map((session) => (
                <button
                  key={session.id}
                  type="button"
                  onClick={() => setSessionId(session.id)}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left text-xs transition-colors',
                    sessionId === session.id
                      ? 'bg-brand-500/10 text-brand-400'
                      : 'text-fg-secondary hover:bg-bg-subtle/50',
                  )}
                >
                  <span className="flex-1 truncate">{session.userIdentifier}</span>
                  <span className="shrink-0 text-fg-muted">{session.status}</span>
                  {session.durationSeconds != null ? (
                    <span className="shrink-0 font-mono tabular-nums text-fg-muted">
                      {formatDuration(session.durationSeconds)}
                    </span>
                  ) : null}
                  <span className="shrink-0 text-fg-muted">
                    {formatDate(session.startedAt, { format: 'relative' })}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : agentId && sessionsLoading ? (
          <div>
            <p className="mb-2 text-xs font-medium text-fg-muted">Recent Sessions</p>
            <div className="rounded-lg border border-fg-subtle/10 bg-bg-base p-4 text-center text-xs text-fg-muted">
              Loading sessions...
            </div>
          </div>
        ) : null}

        <div>
          <Input
            label="Session ID"
            placeholder="Paste a session UUID..."
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
          <p className="text-xs text-error">Failed to evaluate session. Please try again.</p>
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
          Evaluate
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
