import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Spinner } from '~/components/ui/spinner'
import type { SopFormData } from '~/features/sops/components/sop-form'
import { SopForm } from '~/features/sops/components/sop-form'
import { api } from '~/lib/api'
import type { SopDetail, SopUpdate } from '~/schemas/sops'

export const Route = createFileRoute('/_authenticated/sops/$id_/edit')({
  component: EditSopPage,
})

function EditSopPage() {
  const { id } = Route.useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const {
    data: sop,
    isLoading,
    error: fetchError,
  } = useQuery({
    queryKey: ['sops', id],
    queryFn: () => api.get(`sops/${id}`).json<SopDetail>(),
  })

  const updateMutation = useMutation({
    mutationFn: (data: SopUpdate) => api.patch(`sops/${id}`, { json: data }).json<SopDetail>(),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['sops', id] }),
        queryClient.invalidateQueries({ queryKey: ['sops'] }),
      ])
      navigate({ to: '/sops/$id', params: { id } })
    },
  })

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size="lg" />
      </div>
    )
  }

  if (fetchError || !sop) {
    return (
      <div className="rounded-lg border border-error/30 bg-error-muted p-6 text-center">
        <p className="text-sm text-error">Failed to load SOP</p>
      </div>
    )
  }

  const handleSubmit = (data: SopFormData) => {
    const update: SopUpdate = {
      name: data.name,
      description: data.description,
      definition: data.definition,
      version: data.version,
    }
    updateMutation.mutate(update)
  }

  return (
    <SopForm
      initialData={sop}
      onSubmit={handleSubmit}
      isPending={updateMutation.isPending}
      error={updateMutation.error}
      submitLabel="Save Changes"
      backTo={`/sops/${id}`}
    />
  )
}
