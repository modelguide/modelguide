/**
 * Shared building blocks for eval config create/edit forms.
 *
 * Used by EvalConfigPickerDialog (create form) and EvalConfigEditDialog (edit form).
 */

import { useQuery } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '~/components/ui/button'
import { Select } from '~/components/ui/select'
import { api } from '~/lib/api'
import type { Connector, ConnectorTool } from '~/schemas/connectors'

// ---------------------------------------------------------------------------
// Assertion row
// ---------------------------------------------------------------------------

export interface AssertionRow {
  rowId: string
  key: string
  op: string
  value: string
}

export const OP_OPTIONS = ['equals', 'contains', 'gt', 'lt', 'exists', 'matches'] as const

export function newRowId(): string {
  return `row-${crypto.randomUUID().slice(0, 8)}`
}

// ---------------------------------------------------------------------------
// Connector tools hook
// ---------------------------------------------------------------------------

export interface ConnectorWithTools {
  connector: Connector
  tools: ConnectorTool[]
}

export function useAllConnectorTools(): ConnectorWithTools[] {
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
// ConnectorToolSelect
// ---------------------------------------------------------------------------

export function ConnectorToolSelect({
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
// AssertionRowsEditor (tool_input_contains)
// ---------------------------------------------------------------------------

export function AssertionRowsEditor({
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
