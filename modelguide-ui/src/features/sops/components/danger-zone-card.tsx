import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Button } from '~/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '~/components/ui/card'
import { Dialog, DialogFooter } from '~/components/ui/dialog'
import { api } from '~/lib/api'

interface DangerZoneCardProps {
  sopId: string
  sopName: string
  onDeleted: () => void
}

export function DangerZoneCard({ sopId, sopName, onDeleted }: DangerZoneCardProps) {
  const [showConfirm, setShowConfirm] = useState(false)
  const queryClient = useQueryClient()

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`sops/${sopId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sops'] })
      onDeleted()
    },
  })

  return (
    <Card className="border-error/20">
      <CardHeader>
        <CardTitle className="text-error">Danger Zone</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-4 font-sans text-sm text-fg-secondary">
          Permanently delete this SOP and all its step definitions. This action cannot be undone.
        </p>
        <Button variant="danger" onClick={() => setShowConfirm(true)}>
          <Trash2 className="h-4 w-4" />
          Delete SOP
        </Button>
      </CardContent>

      <Dialog
        open={showConfirm}
        onClose={() => setShowConfirm(false)}
        title="Delete SOP"
        description={`Are you sure you want to delete "${sopName}"? This will also remove all step definitions and agent assignments.`}
        size="sm"
      >
        <DialogFooter>
          <Button variant="secondary" onClick={() => setShowConfirm(false)}>
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
  )
}
