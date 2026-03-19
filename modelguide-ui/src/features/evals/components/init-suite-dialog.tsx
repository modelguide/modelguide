import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { ClipboardList } from 'lucide-react'
import { useState } from 'react'
import { Button } from '~/components/ui/button'
import { Dialog, DialogFooter } from '~/components/ui/dialog'
import { Select } from '~/components/ui/select'
import { api } from '~/lib/api'
import type { Agent } from '~/schemas/agents'
import type { EvalSuiteDetail } from '~/schemas/eval-suites'
import type { SopSummary } from '~/schemas/sops'

export interface InitSuiteDialogProps {
  open: boolean
  onClose: () => void
}

export function InitSuiteDialog({ open, onClose }: InitSuiteDialogProps) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  const [agentId, setAgentId] = useState('')
  const [sopId, setSopId] = useState('')

  const { data: agentsData } = useQuery({
    queryKey: ['agents'],
    queryFn: () => api.get('agents').json<{ data: Agent[] }>(),
    enabled: open,
  })

  const { data: sopsData } = useQuery({
    queryKey: ['sops', { status: 'active', agentId: agentId || undefined }],
    queryFn: () =>
      api
        .get('sops', {
          searchParams: {
            status: 'active',
            pageSize: 50,
            ...(agentId ? { agentId } : {}),
          },
        })
        .json<{ data: SopSummary[] }>(),
    enabled: open && agentId !== '',
  })

  const initMutation = useMutation({
    mutationFn: () =>
      api.post('eval-suites/init', { json: { agentId, sopId } }).json<EvalSuiteDetail>(),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['eval-suites'] })
      navigate({ to: '/evals/suites/$suiteId', params: { suiteId: data.id } })
      onClose()
      setAgentId('')
      setSopId('')
    },
  })

  const agents = agentsData?.data ?? []
  const sops = sopsData?.data ?? []
  const agentSelected = agentId !== ''
  const noSopsForAgent = agentSelected && sopsData != null && sops.length === 0
  const canSubmit = agentId !== '' && sopId !== ''

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Create Eval Suite"
      description="Create an eval suite from an agent and SOP pair. Test cases and assertions will be auto-generated from SOP steps."
    >
      <div className="space-y-4">
        <Select
          label="Agent"
          value={agentId}
          onChange={(e) => {
            setAgentId(e.target.value)
            setSopId('')
          }}
        >
          <option value="">Select an agent…</option>
          {agents.map((agent) => (
            <option key={agent.id} value={agent.id}>
              {agent.name}
            </option>
          ))}
        </Select>

        {noSopsForAgent ? (
          <div className="rounded-lg border border-warning/20 bg-warning/5 px-4 py-3">
            <div className="flex items-center gap-2 text-sm font-medium text-warning">
              <ClipboardList className="h-4 w-4 shrink-0" />
              No active SOPs assigned to this agent
            </div>
            <p className="mt-1 text-xs text-fg-muted">
              Assign an active SOP to this agent first, then come back to create an eval suite.
            </p>
            <Link
              to="/agents/$id"
              params={{ id: agentId }}
              className="mt-2 inline-block text-xs font-medium text-brand-400 hover:text-brand-300"
              onClick={onClose}
            >
              Go to agent settings &rarr;
            </Link>
          </div>
        ) : (
          <Select
            label="SOP"
            value={sopId}
            onChange={(e) => setSopId(e.target.value)}
            disabled={!agentId}
          >
            <option value="">{agentId ? 'Select an active SOP…' : 'Select an agent first'}</option>
            {sops.map((sop) => (
              <option key={sop.id} value={sop.id}>
                {sop.name}
              </option>
            ))}
          </Select>
        )}

        {initMutation.error ? (
          <p className="text-xs text-error">Failed to create eval suite. Please try again.</p>
        ) : null}
      </div>

      <DialogFooter>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button
          onClick={() => initMutation.mutate()}
          disabled={!canSubmit}
          loading={initMutation.isPending}
        >
          Create Eval Suite
        </Button>
      </DialogFooter>
    </Dialog>
  )
}
