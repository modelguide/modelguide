import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Check, Plug } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Dialog, DialogFooter } from '~/components/ui/dialog'
import { Spinner } from '~/components/ui/spinner'
import { Toggle } from '~/components/ui/toggle'
import { api } from '~/lib/api'
import type { PaginatedResponse } from '~/lib/pagination'
import type { Connector, ConnectorTool } from '~/schemas/connectors'

interface ToolSelection {
  slug: string
  name: string
  included: boolean
  isEnabled: boolean
  requiresConfirmation: boolean
}

interface AddConnectorDialogProps {
  open: boolean
  onClose: () => void
  agentId: string
  assignedConnectorIds: string[]
}

export function AddConnectorDialog({
  open,
  onClose,
  agentId,
  assignedConnectorIds,
}: AddConnectorDialogProps) {
  const queryClient = useQueryClient()
  const [selectedConnector, setSelectedConnector] = useState<Connector | null>(null)
  const [toolSelections, setToolSelections] = useState<ToolSelection[]>([])

  // Fetch all connectors — dialog needs the full list for selection
  const DIALOG_PAGE_SIZE = 100
  const { data: connectorsData, isLoading: connectorsLoading } = useQuery({
    queryKey: ['connectors', { pageSize: DIALOG_PAGE_SIZE }],
    queryFn: () =>
      api
        .get('connectors', { searchParams: { pageSize: DIALOG_PAGE_SIZE } })
        .json<PaginatedResponse<Connector>>(),
    enabled: open,
  })

  const availableConnectors =
    connectorsData?.data.filter((c) => !assignedConnectorIds.includes(c.id)) ?? []

  const { data: toolsData, isLoading: toolsLoading } = useQuery({
    queryKey: ['connectors', selectedConnector?.id, 'tools'],
    queryFn: () =>
      api.get(`connectors/${selectedConnector?.id}/tools`).json<{ data: ConnectorTool[] }>(),
    enabled: !!selectedConnector,
    staleTime: Number.POSITIVE_INFINITY,
  })

  const assignMutation = useMutation({
    mutationFn: (body: {
      connectorId: string
      tools: { slug: string; isEnabled: boolean; requiresConfirmation: boolean }[]
    }) => api.post(`agents/${agentId}/connectors`, { json: body }).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents', agentId, 'connectors'] })
      handleClose()
    },
  })

  useEffect(() => {
    const loaded = toolsData?.data
    if (!selectedConnector || !loaded?.length) {
      setToolSelections([])
      return
    }
    setToolSelections(
      loaded.map((t) => ({
        slug: t.slug,
        name: t.name,
        included: true,
        isEnabled: true,
        requiresConfirmation: false,
      })),
    )
  }, [selectedConnector, toolsData?.data])

  function resetSelection(): void {
    setSelectedConnector(null)
    setToolSelections([])
  }

  function handleClose(): void {
    resetSelection()
    onClose()
  }

  function updateTool(slug: string, field: keyof ToolSelection, value: boolean): void {
    setToolSelections((prev) => prev.map((t) => (t.slug === slug ? { ...t, [field]: value } : t)))
  }

  function handleAssign(): void {
    if (!selectedConnector) return
    const selectedTools = toolSelections
      .filter((t) => t.included)
      .map((t) => ({
        slug: t.slug,
        isEnabled: t.isEnabled,
        requiresConfirmation: t.requiresConfirmation,
      }))
    assignMutation.mutate({ connectorId: selectedConnector.id, tools: selectedTools })
  }

  const includedCount = toolSelections.filter((t) => t.included).length

  function renderToolConfigStep(): React.ReactNode {
    if (toolsLoading) {
      return (
        <div className="flex justify-center py-8">
          <Spinner size="md" />
        </div>
      )
    }

    if (!toolsData?.data?.length) {
      return (
        <div className="flex flex-col items-center py-8 text-center">
          <p className="text-sm text-fg-muted">This connector has no tools.</p>
        </div>
      )
    }

    return (
      <div className="max-h-80 space-y-2 overflow-y-auto">
        {toolSelections.map((sel) => (
          <div key={sel.slug} className="rounded-lg border border-fg-subtle/10 bg-bg-subtle/50 p-3">
            <div className="flex items-center justify-between">
              <label className="flex cursor-pointer items-center gap-2.5">
                <input
                  type="checkbox"
                  checked={sel.included}
                  onChange={() => updateTool(sel.slug, 'included', !sel.included)}
                  className="h-4 w-4 rounded border-fg-subtle/30 accent-brand-500"
                />
                <div>
                  <span className="font-mono text-xs text-fg-primary">{sel.slug}</span>
                  {sel.name !== sel.slug && (
                    <span className="ml-2 text-xs text-fg-muted">{sel.name}</span>
                  )}
                </div>
              </label>
            </div>
            {sel.included && (
              <div className="ml-6.5 mt-2 flex items-center gap-5">
                <Toggle
                  checked={sel.isEnabled}
                  onChange={() => updateTool(sel.slug, 'isEnabled', !sel.isEnabled)}
                  label="Enabled"
                />
                <Toggle
                  checked={sel.requiresConfirmation}
                  onChange={() =>
                    updateTool(sel.slug, 'requiresConfirmation', !sel.requiresConfirmation)
                  }
                  label="Requires confirmation"
                />
              </div>
            )}
          </div>
        ))}
      </div>
    )
  }

  function renderConnectorListStep(): React.ReactNode {
    if (connectorsLoading) {
      return (
        <div className="flex justify-center py-8">
          <Spinner size="md" />
        </div>
      )
    }

    if (availableConnectors.length === 0) {
      const message =
        connectorsData?.data.length === 0
          ? 'No connectors available.'
          : 'All connectors are already assigned.'
      return (
        <div className="flex flex-col items-center py-8 text-center">
          <Plug className="h-8 w-8 text-fg-muted" />
          <p className="mt-3 text-sm text-fg-muted">{message}</p>
        </div>
      )
    }

    return (
      <div className="max-h-80 space-y-1 overflow-y-auto">
        {availableConnectors.map((connector) => (
          <button
            key={connector.id}
            type="button"
            onClick={() => setSelectedConnector(connector)}
            className="flex w-full items-center gap-3 rounded-lg border border-fg-subtle/10 bg-bg-subtle/50 px-4 py-3 text-left transition-colors hover:border-brand-500/30 hover:bg-bg-subtle"
          >
            <Plug className="h-4 w-4 shrink-0 text-fg-muted" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-fg-primary">{connector.name}</span>
                <span className="font-mono text-xs text-fg-muted">{connector.slug}</span>
              </div>
            </div>
            <Badge variant={connector.isActive ? 'success' : 'default'} dot>
              {connector.isActive ? 'active' : 'inactive'}
            </Badge>
          </button>
        ))}
      </div>
    )
  }

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      title={selectedConnector ? `Configure tools — ${selectedConnector.name}` : 'Add Connector'}
      description={
        selectedConnector
          ? 'Select which tools to include and configure their settings.'
          : 'Choose a connector to link to this agent.'
      }
      size="lg"
    >
      {selectedConnector ? (
        <>
          <button
            type="button"
            onClick={resetSelection}
            className="mb-4 flex items-center gap-1.5 text-xs text-fg-muted transition-colors hover:text-fg-primary"
          >
            <ArrowLeft className="h-3 w-3" />
            Back to connectors
          </button>

          {renderToolConfigStep()}

          {assignMutation.error ? (
            <p className="mt-3 text-xs text-error">Failed to assign connector. Please try again.</p>
          ) : null}

          <DialogFooter>
            <Button variant="secondary" onClick={handleClose}>
              Cancel
            </Button>
            <Button
              onClick={handleAssign}
              loading={assignMutation.isPending}
              disabled={includedCount === 0}
            >
              <Check className="h-4 w-4" />
              Assign {includedCount > 0 ? `(${includedCount} tools)` : ''}
            </Button>
          </DialogFooter>
        </>
      ) : (
        <>
          {renderConnectorListStep()}

          <DialogFooter>
            <Button variant="secondary" onClick={handleClose}>
              Cancel
            </Button>
          </DialogFooter>
        </>
      )}
    </Dialog>
  )
}
