import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Spinner } from '~/components/ui/spinner'
import { KbForm } from '~/features/knowledge-base/components/kb-form'
import { api } from '~/lib/api'
import type { KnowledgeBaseDetail, KnowledgeBaseUpdate } from '~/schemas/knowledge-base'

export const Route = createFileRoute('/_authenticated/knowledge-base/$id_/edit')({
  component: EditKbPage,
})

function EditKbPage() {
  const { id } = Route.useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const {
    data: item,
    isLoading,
    error: fetchError,
  } = useQuery({
    queryKey: ['knowledge-base', id],
    queryFn: () => api.get(`knowledge-base/${id}`).json<KnowledgeBaseDetail>(),
  })

  const updateMutation = useMutation({
    mutationFn: (data: KnowledgeBaseUpdate) =>
      api.patch(`knowledge-base/${id}`, { json: data }).json<KnowledgeBaseDetail>(),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['knowledge-base', id] }),
        queryClient.invalidateQueries({ queryKey: ['knowledge-base'] }),
      ])
      navigate({ to: '/knowledge-base/$id', params: { id } })
    },
  })

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size="lg" />
      </div>
    )
  }

  if (fetchError || !item) {
    return (
      <div className="rounded-lg border border-error/30 bg-error/5 p-6 text-center">
        <p className="text-sm text-error">Failed to load guardrail</p>
      </div>
    )
  }

  return (
    <KbForm
      initialData={item}
      onSubmit={(data) => updateMutation.mutate(data as KnowledgeBaseUpdate)}
      isPending={updateMutation.isPending}
      error={updateMutation.error}
      submitLabel="Save Changes"
      backTo={`/knowledge-base/${id}`}
    />
  )
}
