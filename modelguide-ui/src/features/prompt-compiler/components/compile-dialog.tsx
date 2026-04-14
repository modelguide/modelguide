import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { diffLines } from 'diff'
import { AlertCircle, AlertTriangle, CheckCircle } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '~/components/ui/button'
import { Dialog } from '~/components/ui/dialog'
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
  preselectedSopIds?: string[]
}

export function CompileDialog({
  open,
  onClose,
  agentId,
  currentPrompt,
  preselectedSopIds,
}: CompileDialogProps) {
  const queryClient = useQueryClient()
  const [selectedSopIds, setSelectedSopIds] = useState<Set<string>>(
    () => new Set(preselectedSopIds ?? []),
  )
  const [previewResult, setPreviewResult] = useState<CompileResponse | null>(null)
  const [activeTab, setActiveTab] = useState<'prompt' | 'changes'>('prompt')

  // Load SOPs assigned to this agent
  const { data: sopsData, isLoading: sopsLoading } = useQuery({
    queryKey: ['sops'],
    queryFn: () => api.get('sops').json<PaginatedResponse<SopSummary>>(),
    enabled: open,
    staleTime: 0,
  })

  const agentSops =
    sopsData?.data.filter((sop) => sop.assignedAgents.some((a) => a.id === agentId)) ?? []

  const toggleSop = useCallback((sopId: string) => {
    setSelectedSopIds((prev) => {
      const next = new Set(prev)
      if (next.has(sopId)) {
        next.delete(sopId)
      } else {
        next.add(sopId)
      }
      return next
    })
    setPreviewResult(null)
  }, [])

  const sopIdsArray = useMemo(() => [...selectedSopIds], [selectedSopIds])

  // Dry-run compile (preview)
  const previewMutation = useMutation({
    mutationFn: (sopIds: string[]) =>
      api
        .post(`agents/${agentId}/compile`, {
          json: { sopIds },
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
    mutationFn: (sopIds: string[]) =>
      api.post(`agents/${agentId}/compile`, { json: { sopIds } }).json<CompileResponse>(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents', agentId] })
      toast.success('Prompt compiled successfully')
      handleClose()
    },
  })

  function handleClose() {
    setPreviewResult(null)
    setSelectedSopIds(new Set(preselectedSopIds ?? []))
    setActiveTab('prompt')
    previewMutation.reset()
    applyMutation.reset()
    onClose()
  }

  function handlePreview() {
    if (sopIdsArray.length === 0) return
    previewMutation.mutate(sopIdsArray)
  }

  function handleApply() {
    if (sopIdsArray.length === 0) return
    applyMutation.mutate(sopIdsArray)
  }

  const hasChanges =
    currentPrompt !== null &&
    previewResult !== null &&
    currentPrompt !== previewResult.compiledPrompt
  const isRecompile = currentPrompt !== null && previewResult !== null
  const noSopsAvailable = !sopsLoading && agentSops.length === 0

  // Compute diff stats for the Changes tab label (same counting as PromptDiffViewer)
  const diffStats = useMemo(() => {
    if (!hasChanges || !currentPrompt || !previewResult) return null
    const changes = diffLines(currentPrompt, previewResult.compiledPrompt)
    let added = 0
    let removed = 0
    for (const c of changes) {
      const raw = c.value.endsWith('\n') ? c.value.slice(0, -1) : c.value
      const lineCount = raw.split('\n').length
      if (c.added) added += lineCount
      else if (c.removed) removed += lineCount
    }
    return { added, removed }
  }, [hasChanges, currentPrompt, previewResult])

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      title="Compile Prompt"
      description="Select SOPs and preview the compiled system prompt."
      className="max-w-4xl max-h-[85vh] overflow-hidden"
    >
      <div className="flex flex-col gap-4 min-h-0">
        {/* SOP selection — checkbox list */}
        <div className="shrink-0">
          <p className="mb-2 text-sm font-medium text-fg-secondary">SOPs</p>
          {sopsLoading ? (
            <p className="text-xs text-fg-muted">Loading...</p>
          ) : agentSops.length > 0 ? (
            <div className="max-h-40 overflow-y-auto rounded-lg border border-fg-subtle/10 bg-bg-base">
              {agentSops.map((sop) => (
                <label
                  key={sop.id}
                  className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-bg-subtle transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={selectedSopIds.has(sop.id)}
                    onChange={() => toggleSop(sop.id)}
                    disabled={previewMutation.isPending || applyMutation.isPending}
                    className="h-4 w-4 rounded border-fg-subtle/30 bg-bg-subtle text-brand-500 focus:ring-brand-500"
                  />
                  <span className="text-sm text-fg-primary">{sop.name}</span>
                  <span className="text-xs text-fg-muted">({sop.status})</span>
                </label>
              ))}
            </div>
          ) : null}
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-3 shrink-0">
          <Button
            variant="secondary"
            onClick={handlePreview}
            disabled={sopIdsArray.length === 0 || previewMutation.isPending}
            loading={previewMutation.isPending}
          >
            Preview
          </Button>
          <Button
            onClick={handleApply}
            disabled={
              !previewResult || applyMutation.isPending || (currentPrompt !== null && !hasChanges)
            }
            loading={applyMutation.isPending}
          >
            Apply
          </Button>
          {sopIdsArray.length > 0 ? (
            <span className="text-xs text-fg-muted">
              {sopIdsArray.length} SOP{sopIdsArray.length !== 1 ? 's' : ''} selected
            </span>
          ) : null}
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

            {/* Compiler warnings */}
            {previewResult.metadata?.warnings && previewResult.metadata.warnings.length > 0 ? (
              <div className="flex flex-col gap-1.5 shrink-0">
                {previewResult.metadata.warnings.map((w) => (
                  <div
                    key={w.code}
                    className="flex items-start gap-2 rounded-lg border border-warning/20 bg-warning/[0.06] px-3 py-2.5"
                  >
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
                    <div className="min-w-0">
                      <p className="text-xs text-fg-secondary">{w.message}</p>
                      {w.tokens !== undefined ? (
                        <p className="mt-0.5 font-mono text-[10px] text-fg-muted">
                          {w.tokens} tokens
                        </p>
                      ) : null}
                    </div>
                    <span className="ml-auto shrink-0 font-mono text-[10px] text-fg-muted">
                      {w.code}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}

            {/* Tab bar — show when recompiling (has existing prompt) */}
            {isRecompile ? (
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
                  {diffStats ? (
                    <span className="ml-1.5 text-[10px] text-fg-muted">
                      <span className="text-success">+{diffStats.added}</span>{' '}
                      <span className="text-error">-{diffStats.removed}</span>
                    </span>
                  ) : null}
                </button>
              </div>
            ) : null}

            {/* Content — single scroll container */}
            <div className="overflow-y-auto min-h-0 -mx-1 px-1">
              {activeTab === 'prompt' ? (
                <PromptViewer content={previewResult.compiledPrompt} />
              ) : hasChanges ? (
                <PromptDiffViewer
                  oldContent={currentPrompt ?? ''}
                  newContent={previewResult.compiledPrompt}
                />
              ) : (
                <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
                  <CheckCircle className="h-8 w-8 text-success/60" />
                  <p className="text-sm font-medium text-fg-primary">No changes</p>
                  <p className="text-xs text-fg-muted">
                    The compiled prompt is identical to the current one.
                  </p>
                </div>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </Dialog>
  )
}
