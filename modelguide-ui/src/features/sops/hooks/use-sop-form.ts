import { useQuery } from '@tanstack/react-query'
import { useCallback, useRef, useState } from 'react'
import { useSortableList } from '~/hooks/use-sortable-list'
import { api } from '~/lib/api'
import type { PaginatedResponse } from '~/lib/pagination'
import { slugify } from '~/lib/utils'
import type { Connector, ConnectorTool } from '~/schemas/connectors'
import type { SopDetail, SopTrigger } from '~/schemas/sops'
import type { SopFormData, SopFormProps } from '../components/sop-form'

export type SidebarTab = 'details' | 'trigger' | 'metadata' | 'agents'

export const sidebarTabs: { key: SidebarTab; label: string }[] = [
  { key: 'details', label: 'Details' },
  { key: 'trigger', label: 'Trigger' },
  { key: 'metadata', label: 'Metadata' },
  { key: 'agents', label: 'Agents' },
]

export interface StepForm {
  id: string
  instruction: string
  required: boolean
  notes: string
  connectorToolId: string
}

export interface ConnectorWithTools {
  connector: Connector
  tools: ConnectorTool[]
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

export function useSopForm({
  initialData,
  onSubmit,
}: Pick<SopFormProps, 'initialData' | 'onSubmit'>) {
  const isEditMode = !!initialData

  // --- Queries ---

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

  const { data: agentsData } = useQuery({
    queryKey: ['agents'],
    queryFn: () =>
      api.get('agents').json<PaginatedResponse<{ id: string; name: string; modality: string }>>(),
  })

  // --- Field state ---

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

  const sortable = useSortableList({
    items: steps,
    onReorder: handleReorder,
  })

  // Agents
  const [selectedAgentIds, setSelectedAgentIds] = useState<Set<string>>(
    new Set(initialData?.assignedAgents?.map((a) => a.id) ?? []),
  )

  // Metadata
  const initialMeta = initialData?.definition.metadata
  const [tags, setTags] = useState(initialMeta?.tags?.join(', ') ?? '')
  const [reasonCode, setReasonCode] = useState(initialMeta?.reasonCode ?? '')
  const [estimatedDuration, setEstimatedDuration] = useState(initialMeta?.estimatedDuration ?? '')

  // Sidebar tab
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('details')

  // --- Handlers ---

  const handleNameChange = (value: string) => {
    setName(value)
    if (!slugEdited) {
      setSlug(slugify(value))
    }
  }

  const handleSlugChange = (value: string) => {
    setSlug(value)
    setSlugEdited(true)
  }

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

  const addPattern = () => {
    setPatterns((prev) => [...prev, { id: nextId.current++, value: '' }])
  }

  const removePattern = (id: number) => {
    setPatterns((prev) => prev.filter((p) => p.id !== id))
  }

  const updatePattern = (id: number, value: string) => {
    setPatterns((prev) => prev.map((p) => (p.id === id ? { ...p, value } : p)))
  }

  const addToolSlug = () => {
    setToolSlugs((prev) => [...prev, { id: nextId.current++, value: '' }])
  }

  const removeToolSlug = (id: number) => {
    setToolSlugs((prev) => prev.filter((t) => t.id !== id))
  }

  const updateToolSlug = (id: number, value: string) => {
    setToolSlugs((prev) => prev.map((t) => (t.id === id ? { ...t, value } : t)))
  }

  const toggleChannel = (ch: 'voice' | 'chat' | 'email', checked: boolean) => {
    if (checked) {
      setChannelTypes((prev) => [...prev, ch])
    } else {
      setChannelTypes((prev) => prev.filter((c) => c !== ch))
    }
  }

  // --- Build + submit ---

  const buildTrigger = (): SopTrigger => {
    switch (triggerType) {
      case 'channel':
        return { type: 'channel', config: { channelTypes } }
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

  // --- Validation ---

  const isTriggerValid =
    triggerType === 'manual' ||
    (triggerType === 'channel' && channelTypes.length > 0) ||
    (triggerType === 'intent_detected' && patterns.some((p) => p.value.trim())) ||
    (triggerType === 'tool_present' && toolSlugs.some((t) => t.value.trim()))

  const isValid = !!name.trim() && isTriggerValid && steps.some((s) => s.instruction.trim())

  // --- Derived ---

  const pageTitle = isEditMode ? 'Edit SOP' : 'Create SOP'
  const pageSubtitle = isEditMode
    ? `Editing ${initialData.name}`
    : 'Define a new standard operating procedure from scratch'

  return {
    // Mode
    isEditMode,

    // Queries
    connectorTools,
    agentsData,

    // Fields — details
    name,
    slug,
    description,
    version,
    handleNameChange,
    handleSlugChange,
    setDescription,
    setVersion,

    // Fields — trigger
    triggerType,
    setTriggerType,
    channelTypes,
    toggleChannel,
    patterns,
    addPattern,
    removePattern,
    updatePattern,
    toolSlugs,
    addToolSlug,
    removeToolSlug,
    updateToolSlug,

    // Fields — steps
    steps,
    expandedStepId,
    setExpandedStepId,
    addStep,
    removeStep,
    updateStep,
    sortable,

    // Fields — agents
    selectedAgentIds,
    toggleAgent,

    // Fields — metadata
    tags,
    setTags,
    reasonCode,
    setReasonCode,
    estimatedDuration,
    setEstimatedDuration,

    // Sidebar
    sidebarTab,
    setSidebarTab,

    // Submit
    handleSubmit,
    isValid,

    // Derived
    pageTitle,
    pageSubtitle,
  }
}

export type UseSopFormReturn = ReturnType<typeof useSopForm>
