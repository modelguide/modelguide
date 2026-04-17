import { useMutation, useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '~/components/ui/button'
import { Dialog, DialogFooter } from '~/components/ui/dialog'
import { Input } from '~/components/ui/input'
import { api } from '~/lib/api'
import { cn } from '~/lib/cn'
import type { PaginatedResponse } from '~/lib/pagination'
import type { EvalSuiteSummary } from '~/schemas/eval-suites'

export interface PinToSuiteDialogProps {
  open: boolean
  onClose: () => void
  sessionId: string
  agentId: string
}

export function PinToSuiteDialog({ open, onClose, sessionId, agentId }: PinToSuiteDialogProps) {
  const navigate = useNavigate()
  const [selectedSuiteId, setSelectedSuiteId] = useState('')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')

  function resetAndClose() {
    setSelectedSuiteId('')
    setName('')
    setDescription('')
    onClose()
  }

  const { data: suitesData, isLoading: suitesLoading } = useQuery({
    queryKey: ['eval-suites', { agentId }],
    queryFn: () =>
      api
        .get('eval-suites', { searchParams: { agentId, pageSize: '50' } })
        .json<PaginatedResponse<EvalSuiteSummary>>(),
    enabled: open && !!agentId,
  })

  const pinMutation = useMutation({
    mutationFn: () =>
      api
        .post(`eval-suites/${selectedSuiteId}/test-cases/from-session`, {
          json: {
            sessionId,
            ...(name.trim() ? { name: name.trim() } : {}),
            ...(description.trim() ? { description: description.trim() } : {}),
          },
        })
        .json<{ id: string; suiteId: string }>(),
    onSuccess: (data) => {
      toast.success('Session pinned as regression test case')
      resetAndClose()
      navigate({ to: '/evals/suites/$suiteId', params: { suiteId: data.suiteId } })
    },
    onError: () => {
      toast.error('Failed to pin session')
    },
  })

  const suites = suitesData?.data ?? []

  return (
    <Dialog
      open={open}
      onClose={resetAndClose}
      title="Pin to Suite"
      description="Pin this session as a regression test case in an eval suite."
    >
      <div className="space-y-4">
        {/* Suite picker */}
        <div>
          <p className="mb-2 text-xs font-medium text-fg-muted">Select Suite</p>
          {suitesLoading ? (
            <div className="rounded-lg border border-fg-subtle/10 bg-bg-base p-4 text-center text-xs text-fg-muted">
              Loading suites...
            </div>
          ) : suites.length === 0 ? (
            <div className="rounded-lg border border-fg-subtle/10 bg-bg-base p-4 text-center text-xs text-fg-muted">
              No eval suites for this agent
            </div>
          ) : (
            <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-fg-subtle/10 bg-bg-base p-1.5">
              {suites.map((suite) => (
                <button
                  key={suite.id}
                  type="button"
                  onClick={() => setSelectedSuiteId(suite.id)}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left text-xs transition-colors',
                    selectedSuiteId === suite.id
                      ? 'bg-brand-500/10 text-brand-400'
                      : 'text-fg-secondary hover:bg-bg-subtle/50',
                  )}
                >
                  <span className="flex-1 truncate font-medium">{suite.name}</span>
                  {suite.sopName ? (
                    <span className="shrink-0 text-fg-muted">{suite.sopName}</span>
                  ) : null}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Optional name */}
        <Input
          label="Name (optional)"
          placeholder="Defaults to session identifier + timestamp"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />

        {/* Optional description */}
        <Input
          label="Description (optional)"
          placeholder="Why is this session a good regression test?"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />

        {pinMutation.error ? (
          <p className="text-xs text-error">Failed to pin session. Please try again.</p>
        ) : null}
      </div>

      <DialogFooter>
        <Button variant="secondary" onClick={resetAndClose}>
          Cancel
        </Button>
        <Button
          onClick={() => pinMutation.mutate()}
          disabled={!selectedSuiteId}
          loading={pinMutation.isPending}
        >
          Pin to Suite
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
