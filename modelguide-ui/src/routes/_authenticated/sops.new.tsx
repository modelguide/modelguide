import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { SopForm } from '~/features/sops/components/sop-form'
import { api } from '~/lib/api'
import type { SopCreate, SopDetail } from '~/schemas/sops'

export const Route = createFileRoute('/_authenticated/sops/new')({
  component: NewSopPage,
})

function NewSopPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const createMutation = useMutation({
    mutationFn: (data: SopCreate) => api.post('sops', { json: data }).json<SopDetail>(),
    onSuccess: async (data) => {
      await queryClient.invalidateQueries({ queryKey: ['sops'] })
      navigate({ to: '/sops/$id', params: { id: data.id } })
    },
  })

  return (
    <SopForm
      onSubmit={(data) => createMutation.mutate(data)}
      isPending={createMutation.isPending}
      error={createMutation.error}
      submitLabel="Create SOP"
      backTo="/sops"
    />
  )
}
