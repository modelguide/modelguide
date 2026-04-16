/**
 * EvalConfigEditDialog — edit an existing eval config in-place.
 *
 * Warns the user that saving will update the shared config globally
 * (affecting all suites/cases that reference it). A "Clone & use here"
 * path is handled by the parent; this dialog only handles the global edit.
 *
 * AC-29
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Plus, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Dialog, DialogFooter } from '~/components/ui/dialog'
import { Input } from '~/components/ui/input'
import { Select } from '~/components/ui/select'
import { api } from '~/lib/api'
import type { Connector, ConnectorTool } from '~/schemas/connectors'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EvalConfigForEdit {
  id: string
  name: string
  description: string | null
  evaluatorType: string
  config: Record<string, unknown>
  tags: string[]
}

export interface EvalConfigEditDialogProps {
  open: boolean
  onClose: () => void
  /** The config to edit. When null the dialog is not shown. */
  config: EvalConfigForEdit | null
  /** Called after a successful save with the updated config. */
  onSaved?: (updated: EvalConfigForEdit) => void
  /** Called when the user clicks "Clone & use here". */
  onClone?: (config: EvalConfigForEdit) => void
}

// ---------------------------------------------------------------------------
// Assertion key-value row type
// ---------------------------------------------------------------------------

interface AssertionRow {
  rowId: string
  key: string
  op: string
  value: string
}

let _rowIdCounter = 0
function newRowId() {
  return `row-${++_rowIdCounter}`
}

const OP_OPTIONS = ['equals', 'contains', 'gt', 'lt', 'exists', 'matches'] as const

// ---------------------------------------------------------------------------
// Hook: load all connectors + their tools in one shot
// ---------------------------------------------------------------------------

interface ConnectorWithTools {
  connector: Connector
  tools: ConnectorTool[]
}

function useAllConnectorTools() {
  const { data: connectorsData } = useQuery({
    queryKey: ['connectors'],
    queryFn: () => api.get('connectors').json<{ data: Connector[] }>(),
  })

  const connectorIds = connectorsData?.data?.map((c) => c.id)

  const { data: connectorTools } = useQuery({
    queryKey: ['connector-tools-all', connectorIds],
    queryFn: async () => {
      const connectors = connectorsData?.data ?? []
      return Promise.all(
        connectors.map(async (c) => ({
          connector: c,
          tools: (await api.get(`connectors/${c.id}/tools`).json<{ data: ConnectorTool[] }>()).data,
        })),
      )
    },
    enabled: !!connectorsData?.data?.length,
  })

  return connectorTools ?? []
}

// ---------------------------------------------------------------------------
// Tool select dropdown
// ---------------------------------------------------------------------------

function ConnectorToolSelect({
  value,
  onChange,
  connectorTools,
  label,
}: {
  value: string
  onChange: (id: string) => void
  connectorTools: ConnectorWithTools[]
  label?: string
}) {
  return (
    <Select label={label} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">— select a tool —</option>
      {connectorTools.map(({ connector, tools }) => (
        <optgroup key={connector.id} label={connector.name}>
          {tools.map((t) => (
            <option key={t.id} value={t.id}>
              {connector.name} / {t.name}
            </option>
          ))}
        </optgroup>
      ))}
    </Select>
  )
}

// ---------------------------------------------------------------------------
// Assertion rows editor (tool_input_contains)
// ---------------------------------------------------------------------------

function AssertionRowsEditor({
  rows,
  onChange,
}: {
  rows: AssertionRow[]
  onChange: (rows: AssertionRow[]) => void
}) {
  function update(rowId: string, patch: Partial<AssertionRow>) {
    onChange(rows.map((r) => (r.rowId === rowId ? { ...r, ...patch } : r)))
  }

  function remove(rowId: string) {
    onChange(rows.filter((r) => r.rowId !== rowId))
  }

  function add() {
    onChange([...rows, { rowId: newRowId(), key: '', op: 'equals', value: '' }])
  }

  return (
    <div className="space-y-2">
      {/* biome-ignore lint/a11y/noLabelWithoutControl: static label for group */}
      <label className="mb-1.5 block text-sm font-medium text-fg-secondary">
        Assertions <span className="text-error">*</span>
      </label>
      {rows.map((row) => (
        <div key={row.rowId} className="flex items-center gap-2">
          <input
            type="text"
            value={row.key}
            onChange={(e) => update(row.rowId, { key: e.target.value })}
            placeholder="input key"
            className="w-28 rounded-lg border border-fg-subtle/20 bg-bg-subtle px-2 py-1.5 text-xs text-fg-primary placeholder:text-fg-muted focus:border-brand-500 focus:outline-none"
          />
          <Select
            value={row.op}
            onChange={(e) => update(row.rowId, { op: e.target.value })}
            className="w-28 text-xs"
          >
            {OP_OPTIONS.map((op) => (
              <option key={op} value={op}>
                {op}
              </option>
            ))}
          </Select>
          {row.op !== 'exists' ? (
            <input
              type="text"
              value={row.value}
              onChange={(e) => update(row.rowId, { value: e.target.value })}
              placeholder="value"
              className="flex-1 rounded-lg border border-fg-subtle/20 bg-bg-subtle px-2 py-1.5 text-xs text-fg-primary placeholder:text-fg-muted focus:border-brand-500 focus:outline-none"
            />
          ) : (
            <div className="flex-1" />
          )}
          <button
            type="button"
            onClick={() => remove(row.rowId)}
            className="rounded p-1 text-fg-muted hover:text-error"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      <Button variant="ghost" size="sm" onClick={add}>
        <Plus className="h-3.5 w-3.5" />
        Add assertion
      </Button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse config JSONB into form state. */
function configToForm(
  evaluatorType: string,
  config: Record<string, unknown>,
): { connectorToolId: string; criterion: string; assertionRows: AssertionRow[] } {
  const connectorToolId = (config.connectorToolId as string) ?? ''
  const criterion = (config.criterion as string) ?? ''

  let assertionRows: AssertionRow[] = []
  if (evaluatorType === 'tool_input_contains' && config.assertions) {
    assertionRows = Object.entries(
      config.assertions as Record<string, { op: string; value?: unknown }>,
    ).map(([key, a]) => ({
      rowId: newRowId(),
      key,
      op: a.op,
      value: a.value != null ? String(a.value) : '',
    }))
  }
  if (assertionRows.length === 0 && evaluatorType === 'tool_input_contains') {
    assertionRows = [{ rowId: newRowId(), key: '', op: 'equals', value: '' }]
  }

  return { connectorToolId, criterion, assertionRows }
}

/** Build config JSONB from form state. */
function formToConfig(
  evaluatorType: string,
  connectorToolId: string,
  criterion: string,
  assertionRows: AssertionRow[],
): Record<string, unknown> {
  if (evaluatorType === 'llm_judge') {
    return { criterion }
  }
  if (evaluatorType === 'tool_input_contains') {
    const assertions: Record<string, { op: string; value?: string | number | boolean }> = {}
    for (const row of assertionRows) {
      if (!row.key.trim()) continue
      const entry: { op: string; value?: string | number | boolean } = { op: row.op }
      if (row.op !== 'exists' && row.value.trim()) entry.value = row.value
      assertions[row.key.trim()] = entry
    }
    return { connectorToolId, assertions }
  }
  // tool_called / no_tool_called
  return { connectorToolId }
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function EvalConfigEditDialog({
  open,
  onClose,
  config,
  onSaved,
  onClone,
}: EvalConfigEditDialogProps) {
  const queryClient = useQueryClient()
  const connectorTools = useAllConnectorTools()

  const [name, setName] = useState('')
  const [connectorToolId, setConnectorToolId] = useState('')
  const [criterion, setCriterion] = useState('')
  const [assertionRows, setAssertionRows] = useState<AssertionRow[]>([])

  // Sync form state when config changes
  useEffect(() => {
    if (!config) return
    setName(config.name)
    const {
      connectorToolId: cti,
      criterion: cr,
      assertionRows: ar,
    } = configToForm(config.evaluatorType, config.config)
    setConnectorToolId(cti)
    setCriterion(cr)
    setAssertionRows(ar)
  }, [config])

  const saveMutation = useMutation({
    mutationFn: (data: { name: string; config: Record<string, unknown> }) =>
      api.put(`eval-configs/${config?.id}`, { json: data }).json<EvalConfigForEdit>(),
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ['eval-configs'] })
      queryClient.invalidateQueries({ queryKey: ['eval-suites'] })
      onSaved?.(updated)
      onClose()
    },
  })

  function handleSave() {
    if (!config) return
    const newConfig = formToConfig(config.evaluatorType, connectorToolId, criterion, assertionRows)
    saveMutation.mutate({ name, config: newConfig })
  }

  function isValid() {
    if (!name.trim()) return false
    if (!config) return false
    if (config.evaluatorType === 'llm_judge') return criterion.trim().length > 0
    if (config.evaluatorType === 'tool_input_contains') {
      if (!connectorToolId) return false
      const validRows = assertionRows.filter((r) => r.key.trim())
      return validRows.length > 0
    }
    // tool_called / no_tool_called
    return connectorToolId.length > 0
  }

  const typeBadgeVariant =
    config?.evaluatorType === 'llm_judge'
      ? 'info'
      : config?.evaluatorType === 'tool_called'
        ? 'success'
        : config?.evaluatorType === 'no_tool_called'
          ? 'warning'
          : 'default'

  return (
    <Dialog open={open} onClose={onClose} title="Edit Evaluator Config" size="lg">
      <div className="space-y-4">
        {/* Global-update warning banner */}
        <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2.5 text-xs text-warning">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            <strong>Global update.</strong> Saving will update this config everywhere it is used —
            across all suites, test cases, and SOP steps. Use <strong>Clone &amp; use here</strong>{' '}
            below to create a copy that only affects this suite or test case.
          </span>
        </div>

        {/* Type badge */}
        {config ? (
          <div className="flex items-center gap-2">
            <span className="text-xs text-fg-muted">Type:</span>
            <Badge variant={typeBadgeVariant}>{config.evaluatorType.replace(/_/g, ' ')}</Badge>
            <span className="text-xs text-fg-muted">(immutable)</span>
          </div>
        ) : null}

        <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} required />

        {/* Type-specific config fields */}
        {config?.evaluatorType === 'llm_judge' ? (
          <div>
            <label
              htmlFor="criterion"
              className="mb-1.5 block text-sm font-medium text-fg-secondary"
            >
              Criterion <span className="text-error">*</span>
            </label>
            <textarea
              id="criterion"
              value={criterion}
              onChange={(e) => setCriterion(e.target.value)}
              placeholder="The agent should..."
              rows={4}
              className="w-full rounded-lg border border-fg-subtle/20 bg-bg-subtle px-3 py-2 text-sm text-fg-primary placeholder:text-fg-muted focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
        ) : config?.evaluatorType === 'tool_input_contains' ? (
          <div className="space-y-3">
            <ConnectorToolSelect
              label="Connector Tool"
              value={connectorToolId}
              onChange={setConnectorToolId}
              connectorTools={connectorTools}
            />
            <AssertionRowsEditor rows={assertionRows} onChange={setAssertionRows} />
          </div>
        ) : config?.evaluatorType === 'tool_called' ||
          config?.evaluatorType === 'no_tool_called' ? (
          <ConnectorToolSelect
            label="Connector Tool"
            value={connectorToolId}
            onChange={setConnectorToolId}
            connectorTools={connectorTools}
          />
        ) : null}

        {saveMutation.error ? (
          <p className="text-xs text-error">Failed to save. Please try again.</p>
        ) : null}
      </div>

      <DialogFooter className="justify-between">
        {onClone && config ? (
          <Button
            variant="secondary"
            onClick={() => {
              onClone(config)
              onClose()
            }}
          >
            Clone &amp; use here
          </Button>
        ) : (
          <div />
        )}
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!isValid()} loading={saveMutation.isPending}>
            Save globally
          </Button>
        </div>
      </DialogFooter>
    </Dialog>
  )
}
