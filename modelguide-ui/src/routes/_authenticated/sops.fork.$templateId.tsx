import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { ArrowLeft, GitFork } from 'lucide-react'
import { useState } from 'react'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'
import { Input } from '~/components/ui/input'
import { MutationError } from '~/components/ui/mutation-error'
import { Select } from '~/components/ui/select'
import { Spinner } from '~/components/ui/spinner'
import { SopStepsTimeline } from '~/features/sops/components/sop-steps-timeline'
import { SopTriggerDetail } from '~/features/sops/components/sop-trigger-badge'
import { useAutoSlug } from '~/hooks/use-auto-slug'
import { api } from '~/lib/api'
import type { PaginatedResponse } from '~/lib/pagination'
import type { Connector } from '~/schemas/connectors'
import type { ForkFromTemplate, SopDetail, SopTemplate } from '~/schemas/sops'

export const Route = createFileRoute('/_authenticated/sops/fork/$templateId')({
  component: ForkTemplatePage,
})

function ForkTemplatePage() {
  const { templateId } = Route.useParams()

  const { data: template, isLoading: templateLoading } = useQuery({
    queryKey: ['sop-templates', templateId],
    queryFn: () => api.get(`sops/templates/${templateId}`).json<SopTemplate>(),
  })

  const { data: connectorsData, isLoading: connectorsLoading } = useQuery({
    queryKey: ['connectors'],
    queryFn: () => api.get('connectors').json<PaginatedResponse<Connector>>(),
  })

  const isLoading = templateLoading || connectorsLoading

  if (isLoading) {
    return (
      <div className="space-y-6">
        <BackHeader />
        <div className="flex justify-center py-12">
          <Spinner size="lg" />
        </div>
      </div>
    )
  }

  if (!template) {
    return (
      <div className="space-y-6">
        <BackHeader />
        <div className="rounded-lg border border-error/30 bg-error-muted p-6 text-center">
          <p className="text-sm text-error">Template not found</p>
        </div>
      </div>
    )
  }

  return <ForkForm template={template} connectors={connectorsData?.data ?? []} />
}

function BackHeader() {
  return (
    <div className="flex items-center gap-4 animate-fade-up">
      <Link
        to="/sops"
        search={{ tab: 'templates' }}
        aria-label="Back to templates"
        className="flex h-8 w-8 items-center justify-center rounded-lg text-fg-secondary hover:bg-bg-subtle hover:text-fg-primary transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
      </Link>
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight text-fg-primary">
          Fork Template
        </h1>
        <p className="mt-1 font-sans text-sm text-fg-secondary">Create a new SOP from a template</p>
      </div>
    </div>
  )
}

function ForkForm({
  template,
  connectors,
}: {
  template: SopTemplate
  connectors: Connector[]
}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const { name, slug, handleNameChange, handleSlugChange } = useAutoSlug({
    initialName: template.name,
  })
  const [connectorMapping, setConnectorMapping] = useState<Record<string, string>>({})

  const forkMutation = useMutation({
    mutationFn: (data: ForkFromTemplate) =>
      api.post(`sops/from-template/${template.id}`, { json: data }).json<SopDetail>(),
    onSuccess: async (data) => {
      await queryClient.invalidateQueries({ queryKey: ['sops'] })
      navigate({ to: '/sops/$id', params: { id: data.id } })
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    forkMutation.mutate({
      name: name || undefined,
      slug: slug || undefined,
      connectorMapping,
    })
  }

  const catalogSlugs = template.catalogSlugs
  const allMapped = catalogSlugs.every((cs) => connectorMapping[cs])

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4 animate-fade-up">
        <Link
          to="/sops"
          search={{ tab: 'templates' }}
          aria-label="Back to templates"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-fg-secondary hover:bg-bg-subtle hover:text-fg-primary transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-500/10">
          <GitFork className="h-5 w-5 text-violet-400" />
        </div>
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-fg-primary">
            Fork: {template.name}
          </h1>
          <p className="mt-0.5 font-sans text-sm text-fg-secondary">
            Create a new SOP from this template
          </p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Template Preview */}
        <div className="space-y-6">
          {/* Template Info */}
          <Card>
            <CardHeader>
              <CardTitle>Template Preview</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="space-y-3">
                {template.description ? (
                  <div>
                    <dt className="text-xs font-medium text-fg-muted">Description</dt>
                    <dd className="mt-1 font-sans text-sm text-fg-secondary">
                      {template.description}
                    </dd>
                  </div>
                ) : null}
                <div>
                  <dt className="text-xs font-medium text-fg-muted">Catalogs</dt>
                  <dd className="mt-1.5 flex flex-wrap gap-1.5">
                    {template.catalogSlugs.map((cs) => (
                      <Badge key={cs} variant="brand">
                        {cs}
                      </Badge>
                    ))}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-fg-muted">Trigger</dt>
                  <dd className="mt-2">
                    <SopTriggerDetail trigger={template.definition.trigger} />
                  </dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          {/* Template Steps */}
          <Card>
            <CardHeader>
              <CardTitle>Steps ({template.definition.steps.length})</CardTitle>
            </CardHeader>
            <CardContent>
              <SopStepsTimeline steps={template.definition.steps} />
            </CardContent>
          </Card>
        </div>

        {/* Fork Configuration */}
        <form onSubmit={handleSubmit} className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Configuration</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Input
                label="Name"
                value={name}
                onChange={(e) => handleNameChange(e.target.value)}
                placeholder="SOP name"
              />
              <Input
                label="Slug (optional)"
                value={slug}
                onChange={(e) => handleSlugChange(e.target.value)}
                placeholder="Auto-generated from name"
                hint="URL-friendly identifier"
                className="font-mono"
              />
            </CardContent>
          </Card>

          {/* Connector Mapping */}
          {catalogSlugs.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Connector Mapping</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-fg-secondary">
                  Map each template catalog to one of your connectors
                </p>
                {catalogSlugs.map((cs) => (
                  <Select
                    key={cs}
                    label={`${cs} connector`}
                    value={connectorMapping[cs] ?? ''}
                    onChange={(e) =>
                      setConnectorMapping((prev) => ({
                        ...prev,
                        [cs]: e.target.value,
                      }))
                    }
                  >
                    <option value="">Select a connector...</option>
                    {connectors.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({c.slug})
                      </option>
                    ))}
                  </Select>
                ))}
              </CardContent>
            </Card>
          ) : null}

          {/* Error */}
          <MutationError error={forkMutation.error} fallback="Failed to fork template" />

          {/* Actions */}
          <div className="flex gap-3">
            <Button
              type="submit"
              loading={forkMutation.isPending}
              disabled={catalogSlugs.length > 0 && !allMapped}
            >
              <GitFork className="h-4 w-4" />
              Create from Template
            </Button>
            <Link to="/sops" search={{ tab: 'templates' }}>
              <Button variant="secondary" type="button">
                Cancel
              </Button>
            </Link>
          </div>
        </form>
      </div>
    </div>
  )
}
