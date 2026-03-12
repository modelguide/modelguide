import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { ArrowLeft, Pencil, Shield, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'
import { Dialog, DialogFooter } from '~/components/ui/dialog'
import { Spinner } from '~/components/ui/spinner'
import { KbAgentsCard } from '~/features/knowledge-base/components/kb-agents-card'
import { api } from '~/lib/api'
import { useCanMutate, useIsAdmin } from '~/lib/permissions'
import { formatDate } from '~/lib/utils'
import type { KnowledgeBaseDetail } from '~/schemas/knowledge-base'
import { CATEGORY_LABELS, PRIORITY_LABELS, priorityVariantMap } from '~/schemas/knowledge-base'

export const Route = createFileRoute('/_authenticated/knowledge-base/$id')({
  component: KbDetailPage,
})

function KbDetailPage() {
  const { id } = Route.useParams()
  const navigate = useNavigate()
  const isAdmin = useIsAdmin()
  const canMutate = useCanMutate()
  const queryClient = useQueryClient()
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  const {
    data: item,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['knowledge-base', id],
    queryFn: () => api.get(`knowledge-base/${id}`).json<KnowledgeBaseDetail>(),
  })

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`knowledge-base/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['knowledge-base'] })
      navigate({ to: '/knowledge-base' })
    },
  })

  const toggleActiveMutation = useMutation({
    mutationFn: (isActive: boolean) =>
      api.patch(`knowledge-base/${id}`, { json: { isActive } }).json<KnowledgeBaseDetail>(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['knowledge-base', id] })
      queryClient.invalidateQueries({ queryKey: ['knowledge-base'] })
    },
  })

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size="lg" />
      </div>
    )
  }

  if (error || !item) {
    return (
      <div className="rounded-lg border border-error/30 bg-error/5 p-6 text-center">
        <p className="text-sm text-error">Failed to load guardrail</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4 animate-fade-up">
        <Link
          to="/knowledge-base"
          aria-label="Back to Knowledge Base"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-fg-secondary hover:bg-bg-subtle hover:text-fg-primary transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/10">
          <Shield className="h-5 w-5 text-amber-400" />
        </div>
        <div className="flex-1">
          <h1 className="font-display text-2xl font-bold tracking-tight text-fg-primary">
            {item.name}
          </h1>
          <span className="font-mono text-xs text-fg-muted">{item.slug}</span>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={item.isActive ? 'success' : 'default'} dot>
            {item.isActive ? 'Active' : 'Inactive'}
          </Badge>
          {canMutate ? (
            <>
              <Link to="/knowledge-base/$id/edit" params={{ id }}>
                <Button variant="secondary" size="sm">
                  <Pencil className="h-3.5 w-3.5" />
                  Edit
                </Button>
              </Link>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => toggleActiveMutation.mutate(!item.isActive)}
                loading={toggleActiveMutation.isPending}
              >
                {item.isActive ? 'Deactivate' : 'Activate'}
              </Button>
            </>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Main content */}
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Rule</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-fg-primary whitespace-pre-wrap">{item.content}</p>
            </CardContent>
          </Card>

          {item.description ? (
            <Card>
              <CardHeader>
                <CardTitle>Description</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-fg-secondary whitespace-pre-wrap">{item.description}</p>
              </CardContent>
            </Card>
          ) : null}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="space-y-3">
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-fg-muted">
                    Priority
                  </dt>
                  <dd className="mt-0.5">
                    <Badge variant={priorityVariantMap[item.config.priority]} dot>
                      {PRIORITY_LABELS[item.config.priority]}
                    </Badge>
                  </dd>
                </div>
                {item.config.category ? (
                  <div>
                    <dt className="text-xs font-medium uppercase tracking-wide text-fg-muted">
                      Category
                    </dt>
                    <dd className="mt-0.5 text-sm text-fg-secondary">
                      {CATEGORY_LABELS[item.config.category]}
                    </dd>
                  </div>
                ) : null}
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-fg-muted">
                    Created
                  </dt>
                  <dd className="mt-0.5 text-sm text-fg-secondary">
                    {formatDate(item.createdAt, { format: 'full' })}
                  </dd>
                </div>
                {item.updatedAt ? (
                  <div>
                    <dt className="text-xs font-medium uppercase tracking-wide text-fg-muted">
                      Updated
                    </dt>
                    <dd className="mt-0.5 text-sm text-fg-secondary">
                      {formatDate(item.updatedAt, { format: 'relative' })}
                    </dd>
                  </div>
                ) : null}
              </dl>
            </CardContent>
          </Card>

          <KbAgentsCard kbId={id} agents={item.assignedAgents} canMutate={canMutate} />

          {isAdmin ? (
            <Card className="border-error/20">
              <CardHeader>
                <CardTitle className="text-error">Danger Zone</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="mb-4 font-sans text-sm text-fg-secondary">
                  Permanently delete this guardrail. This action cannot be undone.
                </p>
                <Button variant="danger" onClick={() => setShowDeleteConfirm(true)}>
                  <Trash2 className="h-4 w-4" />
                  Delete Guardrail
                </Button>
              </CardContent>
              <Dialog
                open={showDeleteConfirm}
                onClose={() => setShowDeleteConfirm(false)}
                title="Delete Guardrail"
                description={`Are you sure you want to delete "${item.name}"? This will also remove all agent assignments.`}
                size="sm"
              >
                <DialogFooter>
                  <Button variant="secondary" onClick={() => setShowDeleteConfirm(false)}>
                    Cancel
                  </Button>
                  <Button
                    variant="danger"
                    onClick={() => deleteMutation.mutate()}
                    loading={deleteMutation.isPending}
                  >
                    Delete
                  </Button>
                </DialogFooter>
              </Dialog>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  )
}
