import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ArrowLeft, Bot, ChevronDown, GripVertical, Plus, Terminal, Trash2 } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'
import { useSortableList } from '~/hooks/use-sortable-list'
import { api } from '~/lib/api'
import { cn } from '~/lib/cn'
import type { PaginatedResponse } from '~/lib/pagination'
import { slugify } from '~/lib/utils'
import type { Connector, ConnectorTool } from '~/schemas/connectors'
import type { SopCreate, SopDetail, SopTrigger } from '~/schemas/sops'

type SidebarTab = 'details' | 'trigger' | 'metadata' | 'agents'

const sidebarTabs: { key: SidebarTab; label: string }[] = [
  { key: 'details', label: 'Details' },
  { key: 'trigger', label: 'Trigger' },
  { key: 'metadata', label: 'Metadata' },
  { key: 'agents', label: 'Agents' },
]

interface StepForm {
  id: string
  instruction: string
  required: boolean
  notes: string
  connectorToolId: string
}

interface ConnectorWithTools {
  connector: Connector
  tools: ConnectorTool[]
}

export interface SopFormData extends SopCreate {
  version?: string
}

export interface SopFormProps {
  initialData?: SopDetail
  onSubmit: (data: SopFormData) => void
  isPending: boolean
  error?: Error | null
  submitLabel: string
  backTo: string
}

function deriveInitialSteps(data?: SopDetail): StepForm[] {
  if (!data) {
    return [{ id: 'step-1', instruction: '', required: true, notes: '', connectorToolId: '' }]
  }
  return data.definition.steps.map((s) => ({
    id: s.id,
    instruction: s.instruction,
    required: s.required,
    notes: s.notes ?? '',
    connectorToolId: s.tool?.connectorToolId ?? '',
  }))
}

function deriveInitialPatterns(data?: SopDetail): { id: number; value: string }[] {
  if (
    data?.definition.trigger.type === 'intent_detected' &&
    data.definition.trigger.config.patterns.length > 0
  ) {
    return data.definition.trigger.config.patterns.map((p, i) => ({ id: i, value: p }))
  }
  return [{ id: 0, value: '' }]
}

function deriveInitialToolSlugs(data?: SopDetail): { id: number; value: string }[] {
  if (
    data?.definition.trigger.type === 'tool_present' &&
    data.definition.trigger.config.toolSlugs.length > 0
  ) {
    return data.definition.trigger.config.toolSlugs.map((t, i) => ({ id: i, value: t }))
  }
  return [{ id: 0, value: '' }]
}

function deriveInitialChannelTypes(data?: SopDetail): ('voice' | 'chat' | 'email')[] {
  if (data?.definition.trigger.type === 'channel') {
    return data.definition.trigger.config.channelTypes
  }
  return []
}

export function SopForm({
  initialData,
  onSubmit,
  isPending,
  error,
  submitLabel,
  backTo,
}: SopFormProps) {
  const isEditMode = !!initialData

  // Fetch connectors + their tools for the tool picker
  const { data: connectorsData } = useQuery({
    queryKey: ['connectors'],
    queryFn: () => api.get('connectors').json<{ data: Connector[] }>(),
  })

  const connectorIds = connectorsData?.data?.map((c) => c.id)
  const { data: connectorTools } = useQuery({
    queryKey: ['connector-tools-all', connectorIds],
    queryFn: async () => {
      const connectors = connectorsData?.data ?? []
      const results: ConnectorWithTools[] = await Promise.all(
        connectors.map(async (c) => ({
          connector: c,
          tools: (await api.get(`connectors/${c.id}/tools`).json<{ data: ConnectorTool[] }>()).data,
        })),
      )
      return results
    },
    enabled: !!connectorsData?.data?.length,
  })

  const [name, setName] = useState(initialData?.name ?? '')
  const [slug, setSlug] = useState(initialData?.slug ?? '')
  const [slugEdited, setSlugEdited] = useState(isEditMode)
  const [description, setDescription] = useState(initialData?.description ?? '')
  const [version, setVersion] = useState(initialData?.version ?? '')

  // Trigger
  const [triggerType, setTriggerType] = useState<SopTrigger['type']>(
    initialData?.definition.trigger.type ?? 'manual',
  )
  const [channelTypes, setChannelTypes] = useState<('voice' | 'chat' | 'email')[]>(
    deriveInitialChannelTypes(initialData),
  )

  const initialPatterns = deriveInitialPatterns(initialData)
  const initialToolSlugs = deriveInitialToolSlugs(initialData)

  const nextId = useRef(
    Math.max(...initialPatterns.map((p) => p.id), ...initialToolSlugs.map((t) => t.id)) + 1,
  )
  const nextStepId = useRef(initialData ? initialData.definition.steps.length + 1 : 2)

  const [patterns, setPatterns] = useState(initialPatterns)
  const [toolSlugs, setToolSlugs] = useState(initialToolSlugs)

  // Steps
  const [steps, setSteps] = useState<StepForm[]>(deriveInitialSteps(initialData))
  const [expandedStepId, setExpandedStepId] = useState<string | null>(
    !initialData ? 'step-1' : null,
  )

  const handleReorder = useCallback((reordered: StepForm[]) => {
    setSteps(reordered)
  }, [])

  const { draggedId, dropIndicator, setElementRef } = useSortableList({
    items: steps,
    onReorder: handleReorder,
  })

  // Agents
  const { data: agentsData } = useQuery({
    queryKey: ['agents'],
    queryFn: () =>
      api.get('agents').json<PaginatedResponse<{ id: string; name: string; modality: string }>>(),
  })
  const [selectedAgentIds, setSelectedAgentIds] = useState<Set<string>>(
    new Set(initialData?.assignedAgents?.map((a) => a.id) ?? []),
  )

  const toggleAgent = (agentId: string) => {
    setSelectedAgentIds((prev) => {
      const next = new Set(prev)
      if (next.has(agentId)) {
        next.delete(agentId)
      } else {
        next.add(agentId)
      }
      return next
    })
  }

  // Metadata
  const initialMeta = initialData?.definition.metadata
  const [tags, setTags] = useState(initialMeta?.tags?.join(', ') ?? '')
  const [reasonCode, setReasonCode] = useState(initialMeta?.reasonCode ?? '')
  const [estimatedDuration, setEstimatedDuration] = useState(initialMeta?.estimatedDuration ?? '')

  // Sidebar tab
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('details')

  const handleNameChange = (value: string) => {
    setName(value)
    if (!slugEdited) {
      setSlug(slugify(value))
    }
  }

  const buildTrigger = (): SopTrigger => {
    switch (triggerType) {
      case 'channel':
        return {
          type: 'channel',
          config: { channelTypes },
        }
      case 'intent_detected':
        return {
          type: 'intent_detected',
          config: { patterns: patterns.map((p) => p.value).filter(Boolean) },
        }
      case 'tool_present':
        return {
          type: 'tool_present',
          config: { toolSlugs: toolSlugs.map((t) => t.value).filter(Boolean) },
        }
      default:
        return { type: 'manual', config: {} }
    }
  }

  const addStep = useCallback(() => {
    const id = nextStepId.current++
    const stepId = `step-${id}`
    setSteps((prev) => [
      ...prev,
      { id: stepId, instruction: '', required: true, notes: '', connectorToolId: '' },
    ])
    setExpandedStepId(stepId)
  }, [])

  const removeStep = (index: number) => {
    setSteps((prev) => prev.filter((_, i) => i !== index))
  }

  const updateStep = (index: number, update: Partial<StepForm>) => {
    setSteps((prev) => prev.map((s, i) => (i === index ? { ...s, ...update } : s)))
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    const parsedTags = tags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)

    const agentIds = [...selectedAgentIds]

    onSubmit({
      name,
      slug: slug || undefined,
      description: description || undefined,
      version: version || undefined,
      definition: {
        schemaVersion: 1,
        trigger: buildTrigger(),
        steps: steps
          .filter((s) => s.instruction.trim())
          .map((s) => ({
            id: s.id,
            instruction: s.instruction,
            required: s.required,
            notes: s.notes || undefined,
            tool: s.connectorToolId ? { connectorToolId: s.connectorToolId } : undefined,
          })),
        metadata: {
          tags: parsedTags.length > 0 ? parsedTags : undefined,
          reasonCode: reasonCode || undefined,
          estimatedDuration: estimatedDuration || undefined,
        },
      },
      agentIds: agentIds.length > 0 ? agentIds : undefined,
    })
  }

  const isTriggerValid =
    triggerType === 'manual' ||
    (triggerType === 'channel' && channelTypes.length > 0) ||
    (triggerType === 'intent_detected' && patterns.some((p) => p.value.trim())) ||
    (triggerType === 'tool_present' && toolSlugs.some((t) => t.value.trim()))

  const isValid = name.trim() && isTriggerValid && steps.some((s) => s.instruction.trim())

  const pageTitle = isEditMode ? 'Edit SOP' : 'Create SOP'
  const pageSubtitle = isEditMode
    ? `Editing ${initialData.name}`
    : 'Define a new standard operating procedure from scratch'

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4 animate-fade-up">
        <Link
          to={backTo}
          aria-label="Back to SOPs"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-fg-secondary hover:bg-bg-subtle hover:text-fg-primary transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-fg-primary">
            {pageTitle}
          </h1>
          <p className="mt-1 font-sans text-sm text-fg-secondary">{pageSubtitle}</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="grid gap-6 lg:grid-cols-[1fr_340px]">
        {/* Left column — Steps (primary content) */}
        <Card className="min-w-0">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>
                Steps <span className="text-error">*</span>
              </CardTitle>
              <Button type="button" variant="secondary" size="sm" onClick={addStep}>
                <Plus className="h-3.5 w-3.5" />
                Add Step
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {steps.map((step, index) => {
              const isExpanded = expandedStepId === step.id
              const isDragged = draggedId === step.id
              const showDropTop = dropIndicator?.id === step.id && dropIndicator.edge === 'top'
              const showDropBottom =
                dropIndicator?.id === step.id && dropIndicator.edge === 'bottom'

              return (
                <div key={step.id} className="relative">
                  {showDropTop ? (
                    <div className="absolute -top-1 left-2 right-2 h-0.5 rounded-full bg-brand-500 z-10" />
                  ) : null}
                  <div
                    ref={(el) => setElementRef(step.id, el)}
                    className={cn(
                      'rounded-lg border bg-bg-base transition-all cursor-grab active:cursor-grabbing',
                      isDragged && 'opacity-40',
                      isExpanded
                        ? 'border-brand-500/30 ring-1 ring-brand-500/10'
                        : 'border-fg-subtle/15 hover:border-fg-subtle/30',
                    )}
                  >
                    {/* Step row: drag | number | instruction | badges | actions */}
                    <div className="flex items-start gap-1.5 px-2 py-1.5">
                      <div className="mt-1 shrink-0 rounded p-0.5 text-fg-muted">
                        <GripVertical className="h-3.5 w-3.5" />
                      </div>
                      <Badge className="mt-1 h-5 w-5 shrink-0 justify-center rounded-full px-0 py-0 text-[10px]">
                        {index + 1}
                      </Badge>
                      <textarea
                        value={step.instruction}
                        onChange={(e) => {
                          updateStep(index, { instruction: e.target.value })
                          if (isExpanded) {
                            const el = e.target
                            el.style.height = 'auto'
                            el.style.height = `${el.scrollHeight}px`
                          }
                        }}
                        onFocus={() => {
                          if (!isExpanded) setExpandedStepId(step.id)
                        }}
                        placeholder="What should the agent do in this step?"
                        rows={1}
                        className={cn(
                          'min-w-0 flex-1 resize-none bg-transparent px-1.5 py-0.5 text-sm text-fg-primary placeholder:text-fg-muted',
                          'rounded outline-none transition-colors',
                          'hover:bg-bg-subtle/50 focus:bg-bg-subtle focus:ring-1 focus:ring-brand-500/30',
                          !isExpanded && 'overflow-hidden whitespace-nowrap text-ellipsis',
                        )}
                        ref={(el) => {
                          if (!el) return
                          if (isExpanded) {
                            el.style.height = 'auto'
                            el.style.height = `${el.scrollHeight}px`
                          } else {
                            el.style.height = ''
                          }
                        }}
                      />
                      <div className="mt-0.5 flex shrink-0 items-center gap-1">
                        {/* Tool picker — badge with icon + label, hidden select overlay */}
                        <div className="relative">
                          <Badge
                            variant={step.connectorToolId ? 'info' : 'default'}
                            className="flex items-center gap-1 px-1.5 py-0 text-[10px]"
                          >
                            <Terminal className="h-3 w-3" />
                            Tool
                          </Badge>
                          <select
                            value={step.connectorToolId}
                            onChange={(e) => updateStep(index, { connectorToolId: e.target.value })}
                            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                            title="Select connector tool"
                          >
                            <option value="">No tool</option>
                            {connectorTools?.map((ct) => (
                              <optgroup key={ct.connector.id} label={ct.connector.name}>
                                {ct.tools.map((tool) => (
                                  <option key={tool.id} value={tool.id} disabled={!tool.isActive}>
                                    {ct.connector.slug}_{tool.slug}
                                    {!tool.isActive ? ' (inactive)' : ''}
                                  </option>
                                ))}
                              </optgroup>
                            ))}
                          </select>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => updateStep(index, { required: !step.required })}
                          className={cn(
                            'h-auto rounded-full px-1.5 py-0.5 text-[10px] font-medium',
                            step.required
                              ? 'bg-success-muted text-success hover:bg-success-muted/80'
                              : 'bg-bg-subtle text-fg-muted hover:bg-bg-subtle/80',
                          )}
                        >
                          {step.required ? 'Req' : 'Opt'}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => setExpandedStepId(isExpanded ? null : step.id)}
                          className="h-6 w-6"
                        >
                          <ChevronDown
                            className={cn(
                              'h-3.5 w-3.5 transition-transform',
                              isExpanded && 'rotate-180',
                            )}
                          />
                        </Button>
                        {steps.length > 1 ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => removeStep(index)}
                            className="h-6 w-6 text-fg-muted hover:text-error"
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        ) : null}
                      </div>
                    </div>

                    {/* Expanded: notes */}
                    {isExpanded ? (
                      <div className="px-2 pb-2 pl-[52px]">
                        <input
                          value={step.notes}
                          onChange={(e) => updateStep(index, { notes: e.target.value })}
                          placeholder="Notes..."
                          className="w-full bg-transparent px-1.5 py-0.5 text-xs text-fg-secondary placeholder:text-fg-muted rounded outline-none transition-colors hover:bg-bg-subtle/50 focus:bg-bg-subtle focus:ring-1 focus:ring-brand-500/30"
                        />
                      </div>
                    ) : null}
                  </div>
                  {showDropBottom ? (
                    <div className="absolute -bottom-1 left-2 right-2 h-0.5 rounded-full bg-brand-500 z-10" />
                  ) : null}
                </div>
              )
            })}
          </CardContent>
        </Card>

        {/* Right column — tabbed configuration sidebar */}
        <div className="space-y-4">
          <div className="flex gap-1 rounded-xl bg-bg-subtle p-1">
            {sidebarTabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setSidebarTab(tab.key)}
                className={cn(
                  'flex-1 rounded-lg px-2 py-1.5 text-xs font-medium transition-colors',
                  sidebarTab === tab.key
                    ? 'bg-bg-elevated text-fg-primary shadow-sm'
                    : 'text-fg-secondary hover:text-fg-primary',
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {sidebarTab === 'details' ? (
            <Card>
              <CardContent className="pt-6">
                <dl className="space-y-4">
                  <div>
                    <dt className="text-xs font-medium text-fg-muted">
                      Name <span className="text-error">*</span>
                    </dt>
                    <dd className="mt-1">
                      <input
                        value={name}
                        onChange={(e) => handleNameChange(e.target.value)}
                        placeholder="e.g., Order Lookup"
                        className="w-full bg-transparent px-1.5 py-1 text-sm text-fg-primary placeholder:text-fg-muted rounded outline-none transition-colors hover:bg-bg-subtle focus:bg-bg-subtle focus:ring-1 focus:ring-brand-500/30"
                      />
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium text-fg-muted">Slug</dt>
                    <dd className="mt-1">
                      <input
                        value={slug}
                        onChange={(e) => {
                          setSlug(e.target.value)
                          setSlugEdited(true)
                        }}
                        placeholder="e.g., order-lookup"
                        disabled={isEditMode}
                        className="w-full bg-transparent px-1.5 py-1 font-mono text-sm text-fg-primary placeholder:text-fg-muted rounded outline-none transition-colors hover:bg-bg-subtle focus:bg-bg-subtle focus:ring-1 focus:ring-brand-500/30 disabled:cursor-not-allowed disabled:opacity-50"
                      />
                      {isEditMode ? (
                        <p className="mt-0.5 text-[10px] text-fg-muted">
                          Cannot change slug after creation
                        </p>
                      ) : null}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium text-fg-muted">Description</dt>
                    <dd className="mt-1">
                      <textarea
                        value={description}
                        onChange={(e) => {
                          setDescription(e.target.value)
                          e.target.style.height = 'auto'
                          e.target.style.height = `${e.target.scrollHeight}px`
                        }}
                        ref={(el) => {
                          if (el) {
                            el.style.height = 'auto'
                            el.style.height = `${el.scrollHeight}px`
                          }
                        }}
                        placeholder="What does this SOP do?"
                        rows={2}
                        className="w-full resize-none bg-transparent px-1.5 py-1 text-sm text-fg-primary placeholder:text-fg-muted rounded outline-none transition-colors hover:bg-bg-subtle focus:bg-bg-subtle focus:ring-1 focus:ring-brand-500/30"
                      />
                    </dd>
                  </div>
                  {isEditMode ? (
                    <div>
                      <dt className="text-xs font-medium text-fg-muted">Version</dt>
                      <dd className="mt-1">
                        <input
                          value={version}
                          onChange={(e) => setVersion(e.target.value)}
                          placeholder="e.g., 2"
                          className="w-full bg-transparent px-1.5 py-1 font-mono text-sm text-fg-primary placeholder:text-fg-muted rounded outline-none transition-colors hover:bg-bg-subtle focus:bg-bg-subtle focus:ring-1 focus:ring-brand-500/30"
                        />
                        <p className="mt-0.5 text-[10px] text-fg-muted">
                          Bump when making significant changes
                        </p>
                      </dd>
                    </div>
                  ) : null}
                </dl>
              </CardContent>
            </Card>
          ) : null}

          {sidebarTab === 'trigger' ? (
            <Card>
              <CardContent className="pt-6">
                <dl className="space-y-4">
                  <div>
                    <dt className="text-xs font-medium text-fg-muted">Type</dt>
                    <dd className="mt-1">
                      <select
                        aria-label="Trigger Type"
                        value={triggerType}
                        onChange={(e) => setTriggerType(e.target.value as SopTrigger['type'])}
                        className="w-full appearance-none bg-transparent px-1.5 py-1 text-sm text-fg-primary rounded outline-none transition-colors hover:bg-bg-subtle focus:bg-bg-subtle focus:ring-1 focus:ring-brand-500/30 cursor-pointer"
                      >
                        <option value="manual">Manual</option>
                        <option value="channel">Channel</option>
                        <option value="intent_detected">Intent Detected</option>
                        <option value="tool_present">Tool Present</option>
                      </select>
                    </dd>
                  </div>

                  {triggerType === 'channel' ? (
                    <div>
                      <dt className="text-xs font-medium text-fg-muted">
                        Channel Types <span className="text-error">*</span>
                      </dt>
                      <dd className="mt-1">
                        <div className="flex flex-wrap gap-2 px-1.5 py-1">
                          {(['voice', 'chat', 'email'] as const).map((ch) => (
                            <label key={ch} className="flex items-center gap-1.5 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={channelTypes.includes(ch)}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setChannelTypes((prev) => [...prev, ch])
                                  } else {
                                    setChannelTypes((prev) => prev.filter((c) => c !== ch))
                                  }
                                }}
                                className="h-3.5 w-3.5 rounded border-fg-subtle/30 bg-bg-subtle text-brand-500 focus:ring-brand-500"
                              />
                              <span className="text-xs text-fg-primary capitalize">{ch}</span>
                            </label>
                          ))}
                        </div>
                      </dd>
                    </div>
                  ) : null}

                  {triggerType === 'intent_detected' ? (
                    <div>
                      <dt className="text-xs font-medium text-fg-muted">
                        Patterns <span className="text-error">*</span>
                      </dt>
                      <dd className="mt-1 space-y-1">
                        {patterns.map((pattern) => (
                          <div key={pattern.id} className="flex items-center gap-1">
                            <input
                              value={pattern.value}
                              onChange={(e) => {
                                setPatterns((prev) =>
                                  prev.map((p) =>
                                    p.id === pattern.id ? { ...p, value: e.target.value } : p,
                                  ),
                                )
                              }}
                              placeholder="e.g., where is my order"
                              className="flex-1 bg-transparent px-1.5 py-1 text-sm text-fg-primary placeholder:text-fg-muted rounded outline-none transition-colors hover:bg-bg-subtle focus:bg-bg-subtle focus:ring-1 focus:ring-brand-500/30"
                            />
                            {patterns.length > 1 ? (
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                className="h-5 w-5"
                                onClick={() =>
                                  setPatterns((prev) => prev.filter((p) => p.id !== pattern.id))
                                }
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            ) : null}
                          </div>
                        ))}
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-6 text-xs"
                          onClick={() => {
                            setPatterns((prev) => [...prev, { id: nextId.current++, value: '' }])
                          }}
                        >
                          <Plus className="h-3 w-3" />
                          Add Pattern
                        </Button>
                      </dd>
                    </div>
                  ) : null}

                  {triggerType === 'tool_present' ? (
                    <div>
                      <dt className="text-xs font-medium text-fg-muted">
                        Tool Slugs <span className="text-error">*</span>
                      </dt>
                      <dd className="mt-1 space-y-1">
                        {toolSlugs.map((ts) => (
                          <div key={ts.id} className="flex items-center gap-1">
                            <input
                              value={ts.value}
                              onChange={(e) => {
                                setToolSlugs((prev) =>
                                  prev.map((t) =>
                                    t.id === ts.id ? { ...t, value: e.target.value } : t,
                                  ),
                                )
                              }}
                              placeholder="e.g., get_order"
                              className="flex-1 bg-transparent px-1.5 py-1 font-mono text-sm text-fg-primary placeholder:text-fg-muted rounded outline-none transition-colors hover:bg-bg-subtle focus:bg-bg-subtle focus:ring-1 focus:ring-brand-500/30"
                            />
                            {toolSlugs.length > 1 ? (
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                className="h-5 w-5"
                                onClick={() =>
                                  setToolSlugs((prev) => prev.filter((t) => t.id !== ts.id))
                                }
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            ) : null}
                          </div>
                        ))}
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-6 text-xs"
                          onClick={() => {
                            setToolSlugs((prev) => [...prev, { id: nextId.current++, value: '' }])
                          }}
                        >
                          <Plus className="h-3 w-3" />
                          Add Tool Slug
                        </Button>
                      </dd>
                    </div>
                  ) : null}
                </dl>
              </CardContent>
            </Card>
          ) : null}

          {sidebarTab === 'metadata' ? (
            <Card>
              <CardContent className="pt-6">
                <dl className="space-y-4">
                  <div>
                    <dt className="text-xs font-medium text-fg-muted">Tags</dt>
                    <dd className="mt-1">
                      <input
                        value={tags}
                        onChange={(e) => setTags(e.target.value)}
                        placeholder="e.g., order, tracking, status"
                        className="w-full bg-transparent px-1.5 py-1 text-sm text-fg-primary placeholder:text-fg-muted rounded outline-none transition-colors hover:bg-bg-subtle focus:bg-bg-subtle focus:ring-1 focus:ring-brand-500/30"
                      />
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium text-fg-muted">Reason Code</dt>
                    <dd className="mt-1">
                      <input
                        value={reasonCode}
                        onChange={(e) => setReasonCode(e.target.value)}
                        placeholder="e.g., WISMO-001"
                        className="w-full bg-transparent px-1.5 py-1 font-mono text-sm text-fg-primary placeholder:text-fg-muted rounded outline-none transition-colors hover:bg-bg-subtle focus:bg-bg-subtle focus:ring-1 focus:ring-brand-500/30"
                      />
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium text-fg-muted">Duration</dt>
                    <dd className="mt-1">
                      <input
                        value={estimatedDuration}
                        onChange={(e) => setEstimatedDuration(e.target.value)}
                        placeholder="e.g., 2-5 minutes"
                        className="w-full bg-transparent px-1.5 py-1 text-sm text-fg-primary placeholder:text-fg-muted rounded outline-none transition-colors hover:bg-bg-subtle focus:bg-bg-subtle focus:ring-1 focus:ring-brand-500/30"
                      />
                    </dd>
                  </div>
                </dl>
              </CardContent>
            </Card>
          ) : null}

          {sidebarTab === 'agents' ? (
            <Card>
              <CardContent className="pt-6">
                {!agentsData?.data?.length ? (
                  <p className="text-xs text-fg-muted px-1.5">No agents available</p>
                ) : (
                  <div className="space-y-0.5 max-h-48 overflow-y-auto">
                    {agentsData.data.map((agent) => (
                      <label
                        key={agent.id}
                        className="flex cursor-pointer items-center gap-2.5 rounded px-1.5 py-1.5 transition-colors hover:bg-bg-subtle/50"
                      >
                        <input
                          type="checkbox"
                          checked={selectedAgentIds.has(agent.id)}
                          onChange={() => toggleAgent(agent.id)}
                          className="h-3.5 w-3.5 rounded border-fg-subtle/30 bg-bg-subtle text-brand-500 focus:ring-brand-500"
                        />
                        <Bot className="h-3.5 w-3.5 text-fg-muted" />
                        <span className="flex-1 text-sm text-fg-primary">{agent.name}</span>
                        <span className="text-[10px] text-fg-muted">{agent.modality}</span>
                      </label>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          ) : null}
        </div>

        {/* Error + Actions — full width below the grid */}
        {error ? (
          <p className="font-sans text-sm text-error lg:col-span-2">
            {error instanceof Error ? error.message : 'Something went wrong'}
          </p>
        ) : null}

        <div className="sticky bottom-0 z-10 flex gap-3 border-t border-fg-subtle/10 bg-bg-base/95 py-4 backdrop-blur-sm lg:col-span-2">
          <Button type="submit" loading={isPending} disabled={!isValid}>
            {submitLabel}
          </Button>
          <Link to={backTo}>
            <Button variant="secondary" type="button">
              Cancel
            </Button>
          </Link>
        </div>
      </form>
    </div>
  )
}
