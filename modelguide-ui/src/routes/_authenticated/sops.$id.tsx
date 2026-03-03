import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { Archive, ArrowLeft, ClipboardList, GitFork, Play } from 'lucide-react'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'
import { Spinner } from '~/components/ui/spinner'
import { DangerZoneCard } from '~/features/sops/components/delete-sop-dialog'
import { SopAgentsCard } from '~/features/sops/components/sop-agents-card'
import { SopMetadataCard } from '~/features/sops/components/sop-metadata-card'
import { SopStepsTimeline } from '~/features/sops/components/sop-steps-timeline'
import { SopTriggerDetail } from '~/features/sops/components/sop-trigger-badge'
import { api } from '~/lib/api'
import { useCanMutate, useIsAdmin } from '~/lib/permissions'
import { formatDate } from '~/lib/utils'
import type { SopDetail } from '~/schemas/sops'
import { statusVariantMap } from '~/schemas/sops'

export const Route = createFileRoute('/_authenticated/sops/$id')({
  component: SopDetailPage,
})

function SopDetailPage() {
  const { id } = Route.useParams()
  const navigate = useNavigate()
  const isAdmin = useIsAdmin()
  const canMutate = useCanMutate()
  const queryClient = useQueryClient()

  const {
    data: sop,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['sops', id],
    queryFn: () => api.get(`sops/${id}`).json<SopDetail>(),
  })

  const activateMutation = useMutation({
    mutationFn: () => api.post(`sops/${id}/activate`).json<SopDetail>(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sops', id] })
      queryClient.invalidateQueries({ queryKey: ['sops'] })
    },
  })

  const archiveMutation = useMutation({
    mutationFn: () => api.post(`sops/${id}/archive`).json<SopDetail>(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sops', id] })
      queryClient.invalidateQueries({ queryKey: ['sops'] })
    },
  })

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4 animate-fade-up">
        <Link
          to="/sops"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-fg-secondary hover:bg-bg-subtle hover:text-fg-primary transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-500/10">
          <ClipboardList className="h-5 w-5 text-violet-400" />
        </div>
        <div className="flex-1">
          <h1 className="font-display text-2xl font-bold tracking-tight text-fg-primary">
            {sop?.name ?? 'SOP'}
          </h1>
          {sop ? (
            <div className="mt-0.5 flex items-center gap-2">
              <span className="font-mono text-xs text-fg-muted">{sop.slug}</span>
              {sop.template ? (
                <span className="inline-flex items-center gap-1 text-xs text-fg-muted">
                  <GitFork className="h-3 w-3" />
                  {sop.template.name}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
        {sop ? (
          <div className="flex items-center gap-2">
            <Badge variant={statusVariantMap[sop.status]} dot>
              {sop.status}
            </Badge>
            {canMutate ? (
              <>
                {sop.status === 'draft' || sop.status === 'archived' ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => activateMutation.mutate()}
                    loading={activateMutation.isPending}
                  >
                    <Play className="h-3.5 w-3.5" />
                    Activate
                  </Button>
                ) : null}
                {sop.status === 'active' ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => archiveMutation.mutate()}
                    loading={archiveMutation.isPending}
                  >
                    <Archive className="h-3.5 w-3.5" />
                    Archive
                  </Button>
                ) : null}
              </>
            ) : null}
          </div>
        ) : null}
      </div>

      {activateMutation.isError || archiveMutation.isError ? (
        <div className="rounded-lg border border-error/30 bg-error-muted px-4 py-3">
          <p className="text-sm text-error">
            {activateMutation.isError ? 'Failed to activate SOP' : 'Failed to archive SOP'}
          </p>
        </div>
      ) : null}

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Spinner size="lg" />
        </div>
      ) : error ? (
        <div className="rounded-lg border border-error/30 bg-error-muted p-6 text-center">
          <p className="text-sm text-error">Failed to load SOP</p>
        </div>
      ) : sop ? (
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Details Card */}
          <DetailsCard sop={sop} />

          {/* Trigger Card */}
          <TriggerCard sop={sop} />

          {/* Steps Timeline — full width */}
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Steps ({sop.definition.steps.length})</CardTitle>
            </CardHeader>
            <CardContent>
              {sop.definition.steps.length === 0 ? (
                <p className="font-sans text-sm text-fg-muted">No steps defined</p>
              ) : (
                <SopStepsTimeline steps={sop.definition.steps} warnings={sop.stepWarnings} />
              )}
            </CardContent>
          </Card>

          {/* Metadata Card */}
          <SopMetadataCard metadata={sop.definition.metadata} />

          {/* Agents Card */}
          <SopAgentsCard sopId={sop.id} agents={sop.assignedAgents} canMutate={canMutate} />

          {/* Danger Zone — admin only, full width */}
          {isAdmin ? (
            <div className="lg:col-span-2">
              <DangerZoneCard
                sopId={sop.id}
                sopName={sop.name}
                onDeleted={() => navigate({ to: '/sops' })}
              />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function DetailsCard({ sop }: { sop: SopDetail }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Details</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="space-y-4">
          <div>
            <dt className="text-xs font-medium text-fg-muted">Name</dt>
            <dd className="mt-1 text-sm text-fg-primary">{sop.name}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-fg-muted">Slug</dt>
            <dd className="mt-1 font-mono text-sm text-fg-secondary">{sop.slug}</dd>
          </div>
          {sop.description ? (
            <div>
              <dt className="text-xs font-medium text-fg-muted">Description</dt>
              <dd className="mt-1 font-sans text-sm text-fg-secondary">{sop.description}</dd>
            </div>
          ) : null}
          <div>
            <dt className="text-xs font-medium text-fg-muted">Version</dt>
            <dd className="mt-1 text-sm text-fg-secondary">v{sop.version}</dd>
          </div>
          {sop.template ? (
            <div>
              <dt className="text-xs font-medium text-fg-muted">Template</dt>
              <dd className="mt-1 inline-flex items-center gap-1 text-sm text-fg-secondary">
                <GitFork className="h-3 w-3" />
                {sop.template.name}
              </dd>
            </div>
          ) : null}
          <div>
            <dt className="text-xs font-medium text-fg-muted">Created</dt>
            <dd className="mt-1 text-sm text-fg-secondary">
              {formatDate(sop.createdAt, { format: 'full' })}
            </dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  )
}

function TriggerCard({ sop }: { sop: SopDetail }) {
  const trigger = sop.definition.trigger

  const triggerLabels: Record<string, string> = {
    manual: 'Manual',
    channel: 'Channel',
    intent_detected: 'Intent Detected',
    tool_present: 'Tool Present',
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Trigger</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="space-y-4">
          <div>
            <dt className="text-xs font-medium text-fg-muted">Type</dt>
            <dd className="mt-1 text-sm text-fg-primary">
              {triggerLabels[trigger.type] ?? trigger.type}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-fg-muted">Configuration</dt>
            <dd className="mt-2">
              <SopTriggerDetail trigger={trigger} />
            </dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  )
}
