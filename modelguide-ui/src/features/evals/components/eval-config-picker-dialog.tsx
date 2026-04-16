import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Search, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Dialog, DialogFooter } from '~/components/ui/dialog'
import { Input } from '~/components/ui/input'
import { Select } from '~/components/ui/select'
import { api } from '~/lib/api'
import { cn } from '~/lib/cn'
import type { PaginatedResponse } from '~/lib/pagination'
import type { Connector, ConnectorTool } from '~/schemas/connectors'

// --- Inline eval config type (no separate schema file exists yet) ---

interface EvalConfigItem {
  id: string
  name: string
  description: string | null
  evaluatorType: string
  config: Record<string, unknown>
  tags: string[]
  createdAt: string
}

// --- Evaluator type labels ---

const EVALUATOR_TYPE_LABELS: Record<string, string> = {
  tool_called: 'Tool Called',
  tool_input_contains: 'Tool Input Contains',
  no_tool_called: 'No Tool Called',
  llm_judge: 'LLM Judge',
}

const EVALUATOR_TYPES = [
  'tool_called',
  'tool_input_contains',
  'no_tool_called',
  'llm_judge',
] as const

// --- Assertion rows ---

interface AssertionRow {
  rowId: string
  key: string
  op: string
  value: string
}

const OP_OPTIONS = ['equals', 'contains', 'gt', 'lt', 'exists', 'matches'] as const

let _rowIdCounter = 0
function newRowId() {
  return `row-${++_rowIdCounter}`
}

// --- Connector tools hook ---

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

// --- Tool dropdown ---

function ConnectorToolSelect({
  value,
  onChange,
  connectorTools,
}: {
  value: string
  onChange: (id: string) => void
  connectorTools: ConnectorWithTools[]
}) {
  return (
    <Select label="Connector Tool" value={value} onChange={(e) => onChange(e.target.value)}>
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

// --- Assertion rows editor ---

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

// --- Component ---

export interface EvalConfigPickerDialogProps {
  open: boolean
  onClose: () => void
  onSelect: (config: EvalConfigItem) => void
  /** If true, shows an inline creation form */
  allowCreate?: boolean
}

export function EvalConfigPickerDialog({
  open,
  onClose,
  onSelect,
  allowCreate = true,
}: EvalConfigPickerDialogProps) {
  const queryClient = useQueryClient()
  const connectorTools = useAllConnectorTools()
  const [searchQuery, setSearchQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<string>('all')
  const [showCreateForm, setShowCreateForm] = useState(false)

  // Create form state
  const [newName, setNewName] = useState('')
  const [newType, setNewType] = useState<string>('llm_judge')
  const [newCriterion, setNewCriterion] = useState('')
  const [newConnectorToolId, setNewConnectorToolId] = useState('')
  const [newAssertionRows, setNewAssertionRows] = useState<AssertionRow[]>([
    { rowId: newRowId(), key: '', op: 'equals', value: '' },
  ])

  const { data: configsData, isLoading } = useQuery({
    queryKey: ['eval-configs', { pageSize: 100 }],
    queryFn: () =>
      api
        .get('eval-configs', { searchParams: { pageSize: '100' } })
        .json<PaginatedResponse<EvalConfigItem>>(),
    enabled: open,
  })

  const configs = configsData?.data ?? []

  const filteredConfigs = useMemo(() => {
    let result = configs
    if (typeFilter !== 'all') {
      result = result.filter((c) => c.evaluatorType === typeFilter)
    }
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase()
      result = result.filter(
        (c) => c.name.toLowerCase().includes(q) || c.description?.toLowerCase().includes(q),
      )
    }
    return result
  }, [configs, typeFilter, searchQuery])

  const createMutation = useMutation({
    mutationFn: (data: { name: string; evaluatorType: string; config: Record<string, unknown> }) =>
      api.post('eval-configs', { json: data }).json<EvalConfigItem>(),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ['eval-configs'] })
      setShowCreateForm(false)
      resetCreateForm()
      onSelect(created)
    },
  })

  function resetCreateForm() {
    setNewName('')
    setNewType('llm_judge')
    setNewCriterion('')
    setNewConnectorToolId('')
    setNewAssertionRows([{ rowId: newRowId(), key: '', op: 'equals', value: '' }])
  }

  function buildConfig(): Record<string, unknown> {
    if (newType === 'llm_judge') {
      return { criterion: newCriterion }
    }
    if (newType === 'tool_input_contains') {
      const assertions: Record<string, { op: string; value?: string }> = {}
      for (const row of newAssertionRows) {
        if (!row.key.trim()) continue
        const entry: { op: string; value?: string } = { op: row.op }
        if (row.op !== 'exists' && row.value.trim()) entry.value = row.value
        assertions[row.key.trim()] = entry
      }
      return { connectorToolId: newConnectorToolId, assertions }
    }
    // tool_called / no_tool_called
    return { connectorToolId: newConnectorToolId }
  }

  function isCreateValid() {
    if (!newName.trim()) return false
    if (newType === 'llm_judge') return newCriterion.trim().length > 0
    if (newType === 'tool_input_contains') {
      if (!newConnectorToolId) return false
      return newAssertionRows.some((r) => r.key.trim())
    }
    return newConnectorToolId.length > 0
  }

  function handleCreate() {
    createMutation.mutate({
      name: newName,
      evaluatorType: newType,
      config: buildConfig(),
    })
  }

  function handleClose() {
    setShowCreateForm(false)
    resetCreateForm()
    setSearchQuery('')
    setTypeFilter('all')
    onClose()
  }

  return (
    <Dialog open={open} onClose={handleClose} title="Select Evaluator Config" size="lg">
      {showCreateForm ? (
        <div className="space-y-3">
          <Input
            label="Name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="e.g. Check order lookup"
            required
          />
          <Select
            label="Evaluator Type"
            value={newType}
            onChange={(e) => {
              setNewType(e.target.value)
              setNewConnectorToolId('')
              setNewAssertionRows([{ rowId: newRowId(), key: '', op: 'equals', value: '' }])
            }}
          >
            {EVALUATOR_TYPES.map((t) => (
              <option key={t} value={t}>
                {EVALUATOR_TYPE_LABELS[t]}
              </option>
            ))}
          </Select>

          {newType === 'llm_judge' ? (
            <div>
              <label
                htmlFor="criterion"
                className="mb-1.5 block text-sm font-medium text-fg-secondary"
              >
                Criterion <span className="text-error">*</span>
              </label>
              <textarea
                id="criterion"
                value={newCriterion}
                onChange={(e) => setNewCriterion(e.target.value)}
                placeholder="The agent should..."
                rows={3}
                className="w-full rounded-lg border border-fg-subtle/20 bg-bg-subtle px-3 py-2 text-sm text-fg-primary placeholder:text-fg-muted focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
          ) : newType === 'tool_input_contains' ? (
            <div className="space-y-3">
              <ConnectorToolSelect
                value={newConnectorToolId}
                onChange={setNewConnectorToolId}
                connectorTools={connectorTools}
              />
              <AssertionRowsEditor rows={newAssertionRows} onChange={setNewAssertionRows} />
            </div>
          ) : (
            <ConnectorToolSelect
              value={newConnectorToolId}
              onChange={setNewConnectorToolId}
              connectorTools={connectorTools}
            />
          )}

          {createMutation.error ? (
            <p className="text-xs text-error">Failed to create config. Please try again.</p>
          ) : null}
          <DialogFooter>
            <Button
              variant="secondary"
              onClick={() => {
                setShowCreateForm(false)
                resetCreateForm()
              }}
            >
              Back
            </Button>
            <Button
              onClick={handleCreate}
              disabled={!isCreateValid()}
              loading={createMutation.isPending}
            >
              Create &amp; Select
            </Button>
          </DialogFooter>
        </div>
      ) : (
        <div className="space-y-3">
          {/* Search and filter */}
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-muted" />
              <input
                type="text"
                placeholder="Search configs..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded-lg border border-fg-subtle/10 bg-bg-subtle py-2 pl-9 pr-3 text-sm text-fg-primary placeholder:text-fg-muted focus:border-brand-500/30 focus:outline-none"
              />
            </div>
            <Select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
              <option value="all">All types</option>
              {EVALUATOR_TYPES.map((t) => (
                <option key={t} value={t}>
                  {EVALUATOR_TYPE_LABELS[t]}
                </option>
              ))}
            </Select>
          </div>

          {/* Config list */}
          <div className="max-h-64 space-y-0.5 overflow-y-auto rounded-lg border border-fg-subtle/10 bg-bg-base p-1.5">
            {isLoading ? (
              <div className="px-4 py-8 text-center text-sm text-fg-muted">Loading configs...</div>
            ) : filteredConfigs.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-fg-muted">
                No configs match your search
              </div>
            ) : (
              filteredConfigs.map((config) => (
                <button
                  key={config.id}
                  type="button"
                  onClick={() => onSelect(config)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md px-3 py-2.5 text-left text-sm transition-colors',
                    'hover:bg-bg-subtle/60',
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-fg-primary">{config.name}</p>
                    {config.description ? (
                      <p className="truncate text-xs text-fg-muted">{config.description}</p>
                    ) : null}
                  </div>
                  <Badge variant="info">{EVALUATOR_TYPE_LABELS[config.evaluatorType]}</Badge>
                  {config.tags.length > 0 ? (
                    <div className="flex gap-1">
                      {config.tags.slice(0, 2).map((tag) => (
                        <Badge key={tag} variant="default">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  ) : null}
                </button>
              ))
            )}
          </div>

          {/* Footer with create option */}
          <DialogFooter className="justify-between">
            {allowCreate ? (
              <Button variant="ghost" onClick={() => setShowCreateForm(true)}>
                <Plus className="h-4 w-4" />
                Create new
              </Button>
            ) : (
              <div />
            )}
            <Button variant="secondary" onClick={handleClose}>
              Cancel
            </Button>
          </DialogFooter>
        </div>
      )}
    </Dialog>
  )
}
