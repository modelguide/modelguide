import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { KeyRound, Plus } from 'lucide-react'
import { useState } from 'react'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'
import { PageHeader } from '~/components/ui/page-header'
import { DeleteSecretDialog } from '~/features/secrets/components/delete-secret-dialog'
import { SecretForm } from '~/features/secrets/components/secret-form'
import { SecretsTable } from '~/features/secrets/components/secrets-table'
import { api } from '~/lib/api'
import type { Secret, SecretCreate, SecretListResponse } from '~/schemas/secrets'
import { useAuthStore } from '~/stores/auth'

export const Route = createFileRoute('/_authenticated/secrets')({
  component: SecretsPage,
})

function SecretsPage() {
  const user = useAuthStore((s) => s.user)
  const isAdmin = user?.role === 'admin'
  const queryClient = useQueryClient()

  const [showCreateForm, setShowCreateForm] = useState(false)
  const [secretToDelete, setSecretToDelete] = useState<Secret | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['secrets'],
    queryFn: () => api.get('secrets').json<SecretListResponse>(),
  })

  const createMutation = useMutation({
    mutationFn: (data: SecretCreate) => api.post('secrets', { json: data }).json<Secret>(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['secrets'] })
      setShowCreateForm(false)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`secrets/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['secrets'] })
      setSecretToDelete(null)
    },
  })

  return (
    <div className="space-y-6">
      <PageHeader
        icon={KeyRound}
        iconBg="bg-warning/15"
        iconColor="text-warning"
        title="Secrets"
        description="Manage encrypted credentials and API keys"
        actions={
          isAdmin && !showCreateForm ? (
            <Button onClick={() => setShowCreateForm(true)}>
              <Plus className="h-4 w-4" />
              Add Secret
            </Button>
          ) : null
        }
      />

      {showCreateForm ? (
        <Card className="animate-fade-up">
          <CardHeader>
            <CardTitle>Create New Secret</CardTitle>
          </CardHeader>
          <CardContent>
            <SecretForm
              onSubmit={(data) => createMutation.mutate(data)}
              onCancel={() => setShowCreateForm(false)}
              isSubmitting={createMutation.isPending}
            />
          </CardContent>
        </Card>
      ) : null}

      <SecretsTable
        secrets={data?.items ?? []}
        isLoading={isLoading}
        isAdmin={isAdmin}
        onDelete={(secret) => setSecretToDelete(secret)}
      />

      <DeleteSecretDialog
        open={!!secretToDelete}
        onClose={() => setSecretToDelete(null)}
        onConfirm={() => secretToDelete && deleteMutation.mutate(secretToDelete.id)}
        secret={secretToDelete}
        isDeleting={deleteMutation.isPending}
      />
    </div>
  )
}
