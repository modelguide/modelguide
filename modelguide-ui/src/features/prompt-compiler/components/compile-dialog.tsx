import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertCircle } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '~/components/ui/button'
import { Dialog } from '~/components/ui/dialog'
import { Select } from '~/components/ui/select'
import { Spinner } from '~/components/ui/spinner'
import { api } from '~/lib/api'
import { cn } from '~/lib/cn'
import type { PaginatedResponse } from '~/lib/pagination'
import type { CompileResponse } from '~/schemas/prompt-compiler'
import type { SopSummary } from '~/schemas/sops'
import { CompileSummaryBar } from './compile-summary-bar'
import { PromptDiffViewer } from './prompt-diff-viewer'
import { PromptViewer } from './prompt-viewer'

interface CompileDialogProps {
  open: boolean
  onClose: () => void
  agentId: string
  currentPrompt: string | null
  preselectedSopId?: string
}

export function CompileDialog({
  open,
  onClose,
  agentId,
  currentPrompt,
  preselectedSopId,
}: CompileDialogProps) {
  const queryClient = useQueryClient()
  const [selectedSopId, setSelectedSopId] = useState(preselectedSopId ?? '')
  const [previewResult, setPreviewResult] = useState<CompileResponse | null>(null)
  const [activeTab, setActiveTab] = useState<'prompt' | 'changes'>('prompt')

  // Load SOPs assigned to this agent
  const { data: sopsData, isLoading: sopsLoading } = useQuery({
    queryKey: ['sops'],
    queryFn: () => api.get('sops').json<PaginatedResponse<SopSummary>>(),
    enabled: open,
  })

  const agentSops =
    sopsData?.data.filter((sop) => sop.assignedAgents.some((a) => a.id === agentId)) ?? []

  // Dry-run compile (preview)
  const previewMutation = useMutation({
    mutationFn: (sopId: string) =>
      api
        .post(`agents/${agentId}/compile`, {
          json: { sopId },
          searchParams: { dryRun: 'true' },
        })
        .json<CompileResponse>(),
    onSuccess: (data) => {
      setPreviewResult(data)
      setActiveTab('prompt')
    },
  })

  // Real compile (persist)
  const applyMutation = useMutation({
    mutationFn: (sopId: string) =>
      api.post(`agents/${agentId}/compile`, { json: { sopId } }).json<CompileResponse>(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents', agentId] })
      toast.success('Prompt compiled successfully')
      handleClose()
    },
  })

  function handleClose() {
    setPreviewResult(null)
    setSelectedSopId(preselectedSopId ?? '')
    setActiveTab('prompt')
    previewMutation.reset()
    applyMutation.reset()
    onClose()
  }

  function handlePreview() {
    if (!selectedSopId) return
    previewMutation.mutate(selectedSopId)
  }

  function handleApply() {
    if (!selectedSopId) return
    applyMutation.mutate(selectedSopId)
  }

  const hasChanges = currentPrompt !== null && previewResult !== null
  const noSopsAvailable = !sopsLoading && agentSops.length === 0

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      title="Compile Prompt"
      description="Select an SOP and preview the compiled system prompt."
      className="max-w-4xl max-h-[85vh] overflow-hidden"
    >
      <div className="flex flex-col gap-4 min-h-0">
        {/* Config bar */}
        <div className="flex items-end gap-3 shrink-0">
          <div className="flex-1">
            <Select
              label="SOP"
              value={selectedSopId}
              onChange={(e) => {
                setSelectedSopId(e.target.value)
                setPreviewResult(null)
                previewMutation.reset()
              }}
              disabled={previewMutation.isPending || applyMutation.isPending}
            >
              <option value="">Select an SOP...</option>
              {sopsLoading ? (
                <option disabled>Loading...</option>
              ) : (
                agentSops.map((sop) => (
                  <option key={sop.id} value={sop.id}>
                    {sop.name} ({sop.status})
                  </option>
                ))
              )}
            </Select>
          </div>
          <Button
            variant="secondary"
            onClick={handlePreview}
            disabled={!selectedSopId || previewMutation.isPending}
            loading={previewMutation.isPending}
          >
            Preview
          </Button>
          <Button
            onClick={handleApply}
            disabled={!previewResult || applyMutation.isPending}
            loading={applyMutation.isPending}
          >
            Apply
          </Button>
        </div>

        {/* No SOPs warning */}
        {noSopsAvailable ? (
          <div className="flex items-center gap-2 rounded-lg border border-warning/20 bg-warning/[0.06] px-3 py-2.5">
            <AlertCircle className="h-4 w-4 text-warning shrink-0" />
            <p className="text-xs text-fg-secondary">
              No SOPs are assigned to this agent. Assign an SOP from the SOPs page first.
            </p>
          </div>
        ) : null}

        {/* Error */}
        {previewMutation.error ? (
          <p className="text-xs text-error shrink-0">
            {previewMutation.error instanceof Error
              ? previewMutation.error.message
              : 'Preview failed. Check that the SOP has steps with tool references.'}
          </p>
        ) : null}
        {applyMutation.error ? (
          <p className="text-xs text-error shrink-0">
            {applyMutation.error instanceof Error
              ? applyMutation.error.message
              : 'Compilation failed. Please try again.'}
          </p>
        ) : null}

        {/* Preview loading */}
        {previewMutation.isPending ? (
          <div className="flex items-center justify-center py-12">
            <Spinner size="lg" />
          </div>
        ) : null}

        {/* Preview result */}
        {previewResult ? (
          <div className="flex flex-col gap-4 min-h-0 animate-fade-up">
            {/* Summary bar */}
            <CompileSummaryBar
              compiledFrom={previewResult.compiledFrom}
              promptLength={previewResult.promptLength}
              className="shrink-0"
            />

            {/* Tab bar */}
            {hasChanges ? (
              <div className="flex gap-1 rounded-xl bg-bg-subtle p-1 shrink-0">
                <button
                  type="button"
                  onClick={() => setActiveTab('prompt')}
                  className={cn(
                    'flex-1 rounded-lg px-2 py-1.5 text-xs font-medium transition-colors',
                    activeTab === 'prompt'
                      ? 'bg-bg-elevated text-fg-primary shadow-sm'
                      : 'text-fg-secondary hover:text-fg-primary',
                  )}
                >
                  Prompt
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('changes')}
                  className={cn(
                    'flex-1 rounded-lg px-2 py-1.5 text-xs font-medium transition-colors',
                    activeTab === 'changes'
                      ? 'bg-bg-elevated text-fg-primary shadow-sm'
                      : 'text-fg-secondary hover:text-fg-primary',
                  )}
                >
                  Changes
                </button>
              </div>
            ) : null}

            {/* Content — single scroll container */}
            <div className="overflow-y-auto min-h-0 -mx-1 px-1">
              {activeTab === 'prompt' ? (
                <PromptViewer content={previewResult.compiledPrompt} />
              ) : (
                <PromptDiffViewer
                  oldContent={currentPrompt ?? ''}
                  newContent={previewResult.compiledPrompt}
                />
              )}
            </div>
          </div>
        ) : null}
      </div>
    </Dialog>
  )
}
