import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ArrowLeft, Shield } from 'lucide-react'
import { useState } from 'react'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'
import { useAutoSlug } from '~/hooks/use-auto-slug'
import { api } from '~/lib/api'
import type { PaginatedResponse } from '~/lib/pagination'
import type {
  GuardrailCategory,
  GuardrailPriority,
  KnowledgeBaseCreate,
  KnowledgeBaseDetail,
  KnowledgeBaseUpdate,
} from '~/schemas/knowledge-base'
import {
  CATEGORY_LABELS,
  GUARDRAIL_CATEGORIES,
  GUARDRAIL_PRIORITIES,
  PRIORITY_LABELS,
} from '~/schemas/knowledge-base'

interface Agent {
  id: string
  name: string
  modality: string
}

interface KbFormProps {
  initialData?: KnowledgeBaseDetail
  onSubmit: (data: KnowledgeBaseCreate | KnowledgeBaseUpdate) => void
  isPending: boolean
  error: Error | null
  submitLabel: string
  backTo: string
}

export function KbForm({
  initialData,
  onSubmit,
  isPending,
  error,
  submitLabel,
  backTo,
}: KbFormProps) {
  const isEditMode = !!initialData
  const { name, slug, handleNameChange, handleSlugChange } = useAutoSlug({
    initialName: initialData?.name ?? '',
    initialSlug: initialData?.slug ?? '',
    locked: isEditMode,
  })
  const [content, setContent] = useState(initialData?.content ?? '')
  const [description, setDescription] = useState(initialData?.description ?? '')
  const [priority, setPriority] = useState<GuardrailPriority>(
    initialData?.config?.priority ?? 'medium',
  )
  const [category, setCategory] = useState<GuardrailCategory | ''>(
    initialData?.config?.category ?? '',
  )
  const [isActive, setIsActive] = useState(initialData?.isActive ?? true)
  const [selectedAgentIds, setSelectedAgentIds] = useState<Set<string>>(
    new Set(initialData?.assignedAgents.map((a) => a.id) ?? []),
  )

  const { data: agentsData } = useQuery({
    queryKey: ['agents'],
    queryFn: () => api.get('agents').json<PaginatedResponse<Agent>>(),
  })

  const agents = agentsData?.data ?? []
  const isValid = !!name && !!content

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const config = {
      priority,
      ...(category ? { category } : {}),
    }

    if (isEditMode) {
      const update: KnowledgeBaseUpdate = {
        name,
        content,
        description: description || undefined,
        config,
        isActive,
        agentIds: [...selectedAgentIds],
      }
      onSubmit(update)
    } else {
      const create: KnowledgeBaseCreate = {
        type: 'guardrail',
        name,
        slug: slug || undefined,
        content,
        description: description || undefined,
        config,
        isActive,
        agentIds: [...selectedAgentIds],
      }
      onSubmit(create)
    }
  }

  const toggleAgent = (agentId: string) => {
    setSelectedAgentIds((prev) => {
      const next = new Set(prev)
      if (next.has(agentId)) next.delete(agentId)
      else next.add(agentId)
      return next
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4 animate-fade-up">
        <Link
          to={backTo}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-fg-secondary hover:bg-bg-subtle hover:text-fg-primary transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/10">
          <Shield className="h-5 w-5 text-amber-400" />
        </div>
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-fg-primary">
            {isEditMode ? 'Edit Guardrail' : 'New Guardrail'}
          </h1>
          <p className="text-sm text-fg-muted">
            {isEditMode
              ? 'Update this guardrail rule'
              : 'Define a behavioral constraint for your agents'}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Main content */}
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Rule Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label
                  htmlFor="name"
                  className="block text-sm font-medium text-fg-secondary mb-1.5"
                >
                  Name
                </label>
                <input
                  id="name"
                  type="text"
                  value={name}
                  onChange={(e) => handleNameChange(e.target.value)}
                  placeholder="e.g., No surname usage"
                  className="w-full rounded-lg border border-fg-subtle/15 bg-bg-subtle px-3 py-2 text-sm text-fg-primary placeholder:text-fg-muted focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                />
              </div>

              {!isEditMode ? (
                <div>
                  <label
                    htmlFor="slug"
                    className="block text-sm font-medium text-fg-secondary mb-1.5"
                  >
                    Slug
                  </label>
                  <input
                    id="slug"
                    type="text"
                    value={slug}
                    onChange={(e) => handleSlugChange(e.target.value)}
                    placeholder="auto-generated-from-name"
                    className="w-full rounded-lg border border-fg-subtle/15 bg-bg-subtle px-3 py-2 font-mono text-sm text-fg-primary placeholder:text-fg-muted focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                  />
                </div>
              ) : null}

              <div>
                <label
                  htmlFor="content"
                  className="block text-sm font-medium text-fg-secondary mb-1.5"
                >
                  Rule
                </label>
                <textarea
                  id="content"
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="e.g., Never use the customer's surname in conversation"
                  rows={3}
                  className="w-full rounded-lg border border-fg-subtle/15 bg-bg-subtle px-3 py-2 text-sm text-fg-primary placeholder:text-fg-muted focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 resize-none"
                />
              </div>

              <div>
                <label
                  htmlFor="description"
                  className="block text-sm font-medium text-fg-secondary mb-1.5"
                >
                  Description (optional)
                </label>
                <textarea
                  id="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Why this rule exists, when it applies, etc."
                  rows={2}
                  className="w-full rounded-lg border border-fg-subtle/15 bg-bg-subtle px-3 py-2 text-sm text-fg-primary placeholder:text-fg-muted focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 resize-none"
                />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Configuration</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label
                  htmlFor="priority"
                  className="block text-sm font-medium text-fg-secondary mb-1.5"
                >
                  Priority
                </label>
                <select
                  id="priority"
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as GuardrailPriority)}
                  className="w-full rounded-lg border border-fg-subtle/15 bg-bg-subtle px-3 py-2 text-sm text-fg-primary focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                >
                  {GUARDRAIL_PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {PRIORITY_LABELS[p]}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor="category"
                  className="block text-sm font-medium text-fg-secondary mb-1.5"
                >
                  Category (optional)
                </label>
                <select
                  id="category"
                  value={category}
                  onChange={(e) => setCategory(e.target.value as GuardrailCategory | '')}
                  className="w-full rounded-lg border border-fg-subtle/15 bg-bg-subtle px-3 py-2 text-sm text-fg-primary focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                >
                  <option value="">None</option>
                  {GUARDRAIL_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {CATEGORY_LABELS[c]}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-2">
                <input
                  id="isActive"
                  type="checkbox"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                  className="h-4 w-4 rounded border-fg-subtle/30 bg-bg-subtle text-brand-500 focus:ring-brand-500"
                />
                <label htmlFor="isActive" className="text-sm text-fg-secondary">
                  Active
                </label>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Agent Assignments</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {agents.length === 0 ? (
                  <p className="text-sm text-fg-muted py-2">No agents available</p>
                ) : (
                  agents.map((agent) => (
                    <label
                      key={agent.id}
                      className="flex cursor-pointer items-center gap-3 rounded-lg border border-fg-subtle/10 p-2.5 transition-colors hover:bg-bg-subtle/50"
                    >
                      <input
                        type="checkbox"
                        checked={selectedAgentIds.has(agent.id)}
                        onChange={() => toggleAgent(agent.id)}
                        className="h-4 w-4 rounded border-fg-subtle/30 bg-bg-subtle text-brand-500 focus:ring-brand-500"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-fg-primary truncate">{agent.name}</p>
                      </div>
                      <Badge variant="default">{agent.modality}</Badge>
                    </label>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Error display */}
      {error ? (
        <div className="rounded-lg border border-error/30 bg-error/5 p-3">
          <p className="text-sm text-error">{error.message}</p>
        </div>
      ) : null}

      {/* Actions */}
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={!isValid} loading={isPending}>
          {submitLabel}
        </Button>
        <Link to={backTo}>
          <Button type="button" variant="secondary">
            Cancel
          </Button>
        </Link>
      </div>
    </form>
  )
}
