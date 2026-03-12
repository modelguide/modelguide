import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { KbForm } from '~/features/knowledge-base/components/kb-form'
import { api } from '~/lib/api'
import type { KnowledgeBaseCreate, KnowledgeBaseDetail } from '~/schemas/knowledge-base'

export const Route = createFileRoute('/_authenticated/knowledge-base/new')({
  component: NewKbPage,
})

function NewKbPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const createMutation = useMutation({
    mutationFn: (data: KnowledgeBaseCreate) =>
      api.post('knowledge-base', { json: data }).json<KnowledgeBaseDetail>(),
    onSuccess: async (data) => {
      await queryClient.invalidateQueries({ queryKey: ['knowledge-base'] })
      navigate({ to: '/knowledge-base/$id', params: { id: data.id } })
    },
  })

  return (
    <KbForm
      onSubmit={(data) => createMutation.mutate(data as KnowledgeBaseCreate)}
      isPending={createMutation.isPending}
      error={createMutation.error}
      submitLabel="Create Guardrail"
      backTo="/knowledge-base"
    />
  )
}
