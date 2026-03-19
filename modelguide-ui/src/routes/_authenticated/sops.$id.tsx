import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import {
  Archive,
  ArrowLeft,
  CirclePause,
  ClipboardList,
  FlaskConical,
  GitFork,
  Pencil,
  Play,
} from 'lucide-react'
import { useState } from 'react'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'
import { Spinner } from '~/components/ui/spinner'
import { DangerZoneCard } from '~/features/sops/components/danger-zone-card'
import { SopAgentsCard } from '~/features/sops/components/sop-agents-card'
import { SopMetadataCard } from '~/features/sops/components/sop-metadata-card'
import { SopStepsTimeline } from '~/features/sops/components/sop-steps-timeline'
import { SopTriggerDetail } from '~/features/sops/components/sop-trigger-badge'
import { api } from '~/lib/api'
import { cn } from '~/lib/cn'
import type { PaginatedResponse } from '~/lib/pagination'
import { useCanMutate, useIsAdmin } from '~/lib/permissions'
import { formatDate } from '~/lib/utils'
import type { EvalSuiteSummary } from '~/schemas/eval-suites'
import type { SopDetail } from '~/schemas/sops'
import { TRIGGER_LABELS, statusVariantMap } from '~/schemas/sops'

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

  const deactivateMutation = useMutation({
    mutationFn: () => api.post(`sops/${id}/deactivate`).json<SopDetail>(),
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
          aria-label="Back to SOPs"
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
                <Link to="/sops/$id/edit" params={{ id }}>
                  <Button variant="secondary" size="sm">
                    <Pencil className="h-3.5 w-3.5" />
                    Edit
                  </Button>
                </Link>
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
                    onClick={() => deactivateMutation.mutate()}
                    loading={deactivateMutation.isPending}
                  >
                    <CirclePause className="h-3.5 w-3.5" />
                    Deactivate
                  </Button>
                ) : null}
              </>
            ) : null}
          </div>
        ) : null}
      </div>

      {activateMutation.isError || archiveMutation.isError || deactivateMutation.isError ? (
        <div className="rounded-lg border border-error/30 bg-error-muted px-4 py-3">
          <p className="text-sm text-error">
            {activateMutation.isError
              ? 'Failed to activate SOP'
              : deactivateMutation.isError
                ? 'Failed to deactivate SOP'
                : 'Failed to archive SOP'}
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
        <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
          {/* Left column — Steps (primary content) */}
          <Card>
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

          {/* Right column — tabbed sidebar */}
          <SidebarTabs
            sop={sop}
            canMutate={canMutate}
            isAdmin={isAdmin}
            navigate={navigate}
            archiveMutation={archiveMutation}
          />
        </div>
      ) : null}
    </div>
  )
}

type SidebarTab = 'details' | 'trigger' | 'metadata' | 'agents' | 'evals' | 'settings'

const sidebarTabs: { key: SidebarTab; label: string }[] = [
  { key: 'details', label: 'Details' },
  { key: 'trigger', label: 'Trigger' },
  { key: 'metadata', label: 'Metadata' },
  { key: 'agents', label: 'Agents' },
  { key: 'evals', label: 'Evals' },
  { key: 'settings', label: 'Settings' },
]

function SidebarTabs({
  sop,
  canMutate,
  isAdmin,
  navigate,
  archiveMutation,
}: {
  sop: SopDetail
  canMutate: boolean
  isAdmin: boolean
  navigate: ReturnType<typeof useNavigate>
  archiveMutation: { mutate: () => void; isPending: boolean }
}) {
  const [activeTab, setActiveTab] = useState<SidebarTab>('details')

  const visibleTabs = isAdmin ? sidebarTabs : sidebarTabs.filter((t) => t.key !== 'settings')

  return (
    <div className="space-y-4">
      <div className="flex gap-1 rounded-xl bg-bg-subtle p-1">
        {visibleTabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              'flex-1 rounded-lg px-2 py-1.5 text-xs font-medium transition-colors',
              activeTab === tab.key
                ? 'bg-bg-elevated text-fg-primary shadow-sm'
                : 'text-fg-secondary hover:text-fg-primary',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'details' ? <DetailsCard sop={sop} /> : null}
      {activeTab === 'trigger' ? <TriggerCard sop={sop} /> : null}
      {activeTab === 'metadata' ? <SopMetadataCard metadata={sop.definition.metadata} /> : null}
      {activeTab === 'agents' ? (
        <SopAgentsCard sopId={sop.id} agents={sop.assignedAgents} canMutate={canMutate} />
      ) : null}
      {activeTab === 'evals' ? <SopEvalSuitesCard sopId={sop.id} /> : null}
      {activeTab === 'settings' && isAdmin ? (
        <div className="space-y-6">
          {canMutate && sop.status !== 'archived' ? (
            <Card>
              <CardContent className="pt-6">
                <h3 className="text-sm font-medium text-fg-primary mb-2">Archive</h3>
                <p className="text-xs text-fg-muted mb-4">
                  Archiving removes this SOP from active use. It can be re-activated later.
                </p>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => archiveMutation.mutate()}
                  loading={archiveMutation.isPending}
                >
                  <Archive className="h-3.5 w-3.5" />
                  Archive SOP
                </Button>
              </CardContent>
            </Card>
          ) : null}
          <DangerZoneCard
            sopId={sop.id}
            sopName={sop.name}
            onDeleted={() => navigate({ to: '/sops' })}
          />
        </div>
      ) : null}
    </div>
  )
}

function DetailsCard({ sop }: { sop: SopDetail }) {
  return (
    <Card>
      <CardContent className="pt-6">
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
          {sop.updatedAt ? (
            <div>
              <dt className="text-xs font-medium text-fg-muted">Updated</dt>
              <dd className="mt-1 text-sm text-fg-secondary">
                {formatDate(sop.updatedAt, { format: 'full' })}
              </dd>
            </div>
          ) : null}
        </dl>
      </CardContent>
    </Card>
  )
}

function TriggerCard({ sop }: { sop: SopDetail }) {
  const trigger = sop.definition.trigger

  return (
    <Card>
      <CardContent className="pt-6">
        <dl className="space-y-4">
          <div>
            <dt className="text-xs font-medium text-fg-muted">Type</dt>
            <dd className="mt-1 text-sm text-fg-primary">{TRIGGER_LABELS[trigger.type]}</dd>
          </div>
          {trigger.type !== 'manual' ? (
            <div>
              <dt className="text-xs font-medium text-fg-muted">Configuration</dt>
              <dd className="mt-2">
                <SopTriggerDetail trigger={trigger} />
              </dd>
            </div>
          ) : null}
        </dl>
      </CardContent>
    </Card>
  )
}

function SopEvalSuitesCard({ sopId }: { sopId: string }) {
  const { data } = useQuery({
    queryKey: ['eval-suites', { sopId }],
    queryFn: () =>
      api
        .get('eval-suites', { searchParams: { sopId } })
        .json<PaginatedResponse<EvalSuiteSummary>>(),
  })

  const suites = data?.data ?? []

  return (
    <Card>
      <CardContent className="pt-6">
        {suites.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-6 text-center">
            <FlaskConical className="h-8 w-8 text-fg-muted" />
            <p className="mt-3 text-sm text-fg-muted">No eval suites for this SOP</p>
          </div>
        ) : (
          <div className="space-y-2">
            {suites.map((suite) => (
              <Link
                key={suite.id}
                to="/evals/suites/$suiteId"
                params={{ suiteId: suite.id }}
                className="flex items-center gap-2 rounded-lg border border-fg-subtle/10 bg-bg-subtle/50 px-3 py-2.5 transition-colors hover:border-fg-subtle/20 hover:bg-bg-subtle"
              >
                <FlaskConical className="h-3.5 w-3.5 text-cyan-400" />
                <span className="flex-1 text-sm font-medium text-fg-primary">{suite.name}</span>
              </Link>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
