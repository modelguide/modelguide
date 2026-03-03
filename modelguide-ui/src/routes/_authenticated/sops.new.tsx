import { useMutation } from '@tanstack/react-query'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { ArrowLeft, GripVertical, Plus, Trash2 } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'
import { Input } from '~/components/ui/input'
import { Select } from '~/components/ui/select'
import { Toggle } from '~/components/ui/toggle'
import { api } from '~/lib/api'
import type { SopCreate, SopDetail, SopTrigger } from '~/schemas/sops'

export const Route = createFileRoute('/_authenticated/sops/new')({
  component: NewSopPage,
})

interface StepForm {
  id: string
  instruction: string
  required: boolean
  notes: string
}

function NewSopPage() {
  const navigate = useNavigate()

  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugEdited, setSlugEdited] = useState(false)
  const [description, setDescription] = useState('')

  // Trigger
  const [triggerType, setTriggerType] = useState<SopTrigger['type']>('manual')
  const [channelTypes, setChannelTypes] = useState<('voice' | 'chat' | 'email')[]>([])
  const nextId = useRef(1)
  const nextStepId = useRef(2)
  const [patterns, setPatterns] = useState<{ id: number; value: string }[]>([{ id: 0, value: '' }])
  const [toolSlugs, setToolSlugs] = useState<{ id: number; value: string }[]>([
    { id: 0, value: '' },
  ])

  // Steps
  const [steps, setSteps] = useState<StepForm[]>([
    { id: 'step-1', instruction: '', required: true, notes: '' },
  ])

  // Metadata
  const [showMetadata, setShowMetadata] = useState(false)
  const [tags, setTags] = useState('')
  const [reasonCode, setReasonCode] = useState('')
  const [estimatedDuration, setEstimatedDuration] = useState('')

  const createMutation = useMutation({
    mutationFn: (data: SopCreate) => api.post('sops', { json: data }).json<SopDetail>(),
    onSuccess: (data) => navigate({ to: '/sops/$id', params: { id: data.id } }),
  })

  const handleNameChange = (value: string) => {
    setName(value)
    if (!slugEdited) {
      setSlug(
        value
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, ''),
      )
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
    setSteps((prev) => [...prev, { id: `step-${id}`, instruction: '', required: true, notes: '' }])
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

    createMutation.mutate({
      name,
      slug: slug || undefined,
      description: description || undefined,
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
          })),
        metadata: {
          tags: parsedTags.length > 0 ? parsedTags : undefined,
          reasonCode: reasonCode || undefined,
          estimatedDuration: estimatedDuration || undefined,
        },
      },
    })
  }

  const isTriggerValid =
    triggerType === 'manual' ||
    (triggerType === 'channel' && channelTypes.length > 0) ||
    (triggerType === 'intent_detected' && patterns.some((p) => p.value.trim())) ||
    (triggerType === 'tool_present' && toolSlugs.some((t) => t.value.trim()))

  const isValid = name.trim() && isTriggerValid && steps.some((s) => s.instruction.trim())

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4 animate-fade-up">
        <Link
          to="/sops"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-fg-secondary hover:bg-bg-subtle hover:text-fg-primary transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-fg-primary">
            Create SOP
          </h1>
          <p className="mt-1 font-sans text-sm text-fg-secondary">
            Define a new standard operating procedure from scratch
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6 max-w-2xl">
        {/* Basic Info */}
        <Card>
          <CardHeader>
            <CardTitle>Basic Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Input
              label="Name"
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder="e.g., Order Lookup"
              required
            />
            <Input
              label="Slug"
              value={slug}
              onChange={(e) => {
                setSlug(e.target.value)
                setSlugEdited(true)
              }}
              placeholder="e.g., order-lookup"
              hint="URL-friendly identifier (lowercase, hyphens, underscores)"
              className="font-mono"
            />
            <div>
              <label
                htmlFor="description"
                className="mb-1.5 block text-sm font-medium text-fg-secondary"
              >
                Description
              </label>
              <textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What does this SOP do?"
                rows={3}
                className="flex w-full rounded-lg border border-fg-subtle/20 bg-bg-subtle px-3 py-2 text-sm text-fg-primary placeholder:text-fg-muted transition-colors hover:border-fg-subtle focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
          </CardContent>
        </Card>

        {/* Trigger */}
        <Card>
          <CardHeader>
            <CardTitle>Trigger</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Select
              label="Trigger Type"
              value={triggerType}
              onChange={(e) => setTriggerType(e.target.value as SopTrigger['type'])}
            >
              <option value="manual">Manual</option>
              <option value="channel">Channel</option>
              <option value="intent_detected">Intent Detected</option>
              <option value="tool_present">Tool Present</option>
            </Select>

            {triggerType === 'channel' ? (
              <div>
                <p className="mb-2 text-sm font-medium text-fg-secondary">Channel Types</p>
                <div className="flex gap-4">
                  {(['voice', 'chat', 'email'] as const).map((ch) => (
                    <label key={ch} className="flex items-center gap-2 cursor-pointer">
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
                        className="h-4 w-4 rounded border-fg-subtle/30 bg-bg-subtle text-brand-500 focus:ring-brand-500"
                      />
                      <span className="text-sm text-fg-primary capitalize">{ch}</span>
                    </label>
                  ))}
                </div>
              </div>
            ) : null}

            {triggerType === 'intent_detected' ? (
              <div className="space-y-2">
                <p className="text-sm font-medium text-fg-secondary">Patterns</p>
                {patterns.map((pattern) => (
                  <div key={pattern.id} className="flex gap-2">
                    <Input
                      value={pattern.value}
                      onChange={(e) => {
                        setPatterns((prev) =>
                          prev.map((p) =>
                            p.id === pattern.id ? { ...p, value: e.target.value } : p,
                          ),
                        )
                      }}
                      placeholder="e.g., where is my order"
                    />
                    {patterns.length > 1 ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        onClick={() =>
                          setPatterns((prev) => prev.filter((p) => p.id !== pattern.id))
                        }
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    ) : null}
                  </div>
                ))}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setPatterns((prev) => [...prev, { id: nextId.current++, value: '' }])
                  }}
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add Pattern
                </Button>
              </div>
            ) : null}

            {triggerType === 'tool_present' ? (
              <div className="space-y-2">
                <p className="text-sm font-medium text-fg-secondary">Tool Slugs</p>
                {toolSlugs.map((ts) => (
                  <div key={ts.id} className="flex gap-2">
                    <Input
                      value={ts.value}
                      onChange={(e) => {
                        setToolSlugs((prev) =>
                          prev.map((t) => (t.id === ts.id ? { ...t, value: e.target.value } : t)),
                        )
                      }}
                      placeholder="e.g., get_order"
                      className="font-mono"
                    />
                    {toolSlugs.length > 1 ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => setToolSlugs((prev) => prev.filter((t) => t.id !== ts.id))}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    ) : null}
                  </div>
                ))}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setToolSlugs((prev) => [...prev, { id: nextId.current++, value: '' }])
                  }}
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add Tool Slug
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>

        {/* Steps */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Steps</CardTitle>
              <Button type="button" variant="secondary" size="sm" onClick={addStep}>
                <Plus className="h-3.5 w-3.5" />
                Add Step
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {steps.map((step, index) => (
              <div
                key={step.id}
                className="rounded-xl border border-fg-subtle/15 bg-bg-base p-4 space-y-3"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <GripVertical className="h-4 w-4 text-fg-muted" />
                    <span className="text-sm font-medium text-fg-secondary">Step {index + 1}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <Toggle
                      checked={step.required}
                      onChange={() => updateStep(index, { required: !step.required })}
                      label={step.required ? 'Required' : 'Optional'}
                    />
                    {steps.length > 1 ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => removeStep(index)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    ) : null}
                  </div>
                </div>
                <div>
                  <label
                    htmlFor={`step-${index}-instruction`}
                    className="mb-1.5 block text-sm font-medium text-fg-secondary"
                  >
                    Instruction
                  </label>
                  <textarea
                    id={`step-${index}-instruction`}
                    value={step.instruction}
                    onChange={(e) => updateStep(index, { instruction: e.target.value })}
                    placeholder="What should the agent do in this step?"
                    rows={2}
                    className="flex w-full rounded-lg border border-fg-subtle/20 bg-bg-subtle px-3 py-2 text-sm text-fg-primary placeholder:text-fg-muted transition-colors hover:border-fg-subtle focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                </div>
                <Input
                  label="Notes (optional)"
                  value={step.notes}
                  onChange={(e) => updateStep(index, { notes: e.target.value })}
                  placeholder="Additional notes for this step"
                />
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Metadata (collapsible) */}
        <Card>
          <CardHeader>
            <button
              type="button"
              onClick={() => setShowMetadata(!showMetadata)}
              className="flex w-full items-center justify-between"
            >
              <CardTitle>Metadata</CardTitle>
              <span className="text-xs text-fg-muted">{showMetadata ? 'Hide' : 'Show'}</span>
            </button>
          </CardHeader>
          {showMetadata ? (
            <CardContent className="space-y-4">
              <Input
                label="Tags (comma-separated)"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="e.g., order, tracking, status"
              />
              <Input
                label="Reason Code"
                value={reasonCode}
                onChange={(e) => setReasonCode(e.target.value)}
                placeholder="e.g., WISMO-001"
                className="font-mono"
              />
              <Input
                label="Estimated Duration"
                value={estimatedDuration}
                onChange={(e) => setEstimatedDuration(e.target.value)}
                placeholder="e.g., 2-5 minutes"
              />
            </CardContent>
          ) : null}
        </Card>

        {/* Error */}
        {createMutation.isError ? (
          <p className="font-sans text-sm text-error">
            {createMutation.error instanceof Error
              ? createMutation.error.message
              : 'Failed to create SOP'}
          </p>
        ) : null}

        {/* Actions */}
        <div className="flex gap-3">
          <Button type="submit" loading={createMutation.isPending} disabled={!isValid}>
            Create SOP
          </Button>
          <Link to="/sops">
            <Button variant="secondary" type="button">
              Cancel
            </Button>
          </Link>
        </div>
      </form>
    </div>
  )
}
