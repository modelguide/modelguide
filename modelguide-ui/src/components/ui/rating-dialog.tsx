import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ThumbsDown, ThumbsUp } from 'lucide-react'
import { useState } from 'react'
import { api } from '~/lib/api'
import { cn } from '~/lib/cn'
import { Button } from './button'
import { Dialog } from './dialog'

export interface RatingDialogProps {
  sessionId: string
  open: boolean
  onClose: () => void
  onSuccess?: () => void
}

export function RatingDialog({ sessionId, open, onClose, onSuccess }: RatingDialogProps) {
  const queryClient = useQueryClient()
  const [rating, setRating] = useState<number | null>(null)
  const [comment, setComment] = useState('')

  const mutation = useMutation({
    mutationFn: (data: { rating: number; comment: string }) =>
      api
        .post(`sessions/${sessionId}/feedback`, { json: { ...data, feedback_source: 'support' } })
        .json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] })
      onSuccess?.()
      onClose()
    },
  })

  const handleSubmit = () => {
    if (rating !== null) {
      mutation.mutate({ rating, comment })
    }
  }

  const handleClose = () => {
    setRating(null)
    setComment('')
    onClose()
  }

  return (
    <Dialog open={open} onClose={handleClose} title="Rate Session" size="sm">
      <div className="space-y-4">
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => setRating(2)}
            className={cn(
              'flex flex-1 items-center justify-center gap-2 rounded-xl border-2 py-3 text-sm font-semibold transition-all duration-200',
              rating === 2
                ? 'border-success bg-success/10 text-success scale-[1.02]'
                : 'border-fg-subtle/20 text-fg-muted hover:border-success/40 hover:text-success',
            )}
          >
            <ThumbsUp className="h-5 w-5" />
            Good
          </button>
          <button
            type="button"
            onClick={() => setRating(1)}
            className={cn(
              'flex flex-1 items-center justify-center gap-2 rounded-xl border-2 py-3 text-sm font-semibold transition-all duration-200',
              rating === 1
                ? 'border-error bg-error/10 text-error scale-[1.02]'
                : 'border-fg-subtle/20 text-fg-muted hover:border-error/40 hover:text-error',
            )}
          >
            <ThumbsDown className="h-5 w-5" />
            Bad
          </button>
        </div>

        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Add a note (optional)"
          className="w-full rounded-xl border border-fg-subtle/20 bg-bg-subtle px-4 py-3 text-sm text-fg-primary placeholder:text-fg-muted transition-colors focus:border-brand-500 focus:outline-none resize-none"
          rows={2}
        />

        <div className="flex gap-3">
          <Button variant="secondary" onClick={handleClose} className="flex-1">
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            loading={mutation.isPending}
            disabled={rating === null}
            className="flex-1"
          >
            Save
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
