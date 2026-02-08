import { useMutation, useQueryClient } from '@tanstack/react-query'
import { HTTPError } from 'ky'
import { ThumbsDown, ThumbsUp } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '~/lib/api'
import { cn } from '~/lib/cn'
import { Button } from './button'
import { Dialog } from './dialog'

export interface RatingDialogProps {
  sessionId: string
  open: boolean
  onClose: () => void
  onSuccess?: () => void
  /** When editing, pass the existing feedback to pre-populate */
  existingFeedback?: { id: string; rating: number; comment: string | null }
}

export function RatingDialog({
  sessionId,
  open,
  onClose,
  onSuccess,
  existingFeedback,
}: RatingDialogProps) {
  const queryClient = useQueryClient()
  const isEdit = !!existingFeedback
  const [rating, setRating] = useState<number | null>(existingFeedback?.rating ?? null)
  const [comment, setComment] = useState(existingFeedback?.comment ?? '')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  // biome-ignore lint/correctness/useExhaustiveDependencies: sync form state only when dialog opens
  useEffect(() => {
    if (open) {
      setRating(existingFeedback?.rating ?? null)
      setComment(existingFeedback?.comment ?? '')
      setErrorMessage(null)
      mutation.reset()
    }
  }, [open])

  const mutation = useMutation({
    mutationFn: (data: { rating: number; comment: string }) => {
      if (isEdit) {
        return api
          .patch(`sessions/${sessionId}/feedback/${existingFeedback.id}`, {
            json: { rating: data.rating, comment: data.comment || undefined },
          })
          .json()
      }
      return api
        .post(`sessions/${sessionId}/feedback`, {
          json: { ...data, feedbackSource: 'support' },
        })
        .json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] })
      queryClient.invalidateQueries({ queryKey: ['sessions', sessionId] })
      onSuccess?.()
      onClose()
    },
    onError: async (error) => {
      let message = 'Failed to save rating. Please try again.'
      if (error instanceof HTTPError) {
        try {
          const body = await error.response.clone().json()
          if (body.message) message = body.message
        } catch {
          // non-JSON response
        }
      }
      setErrorMessage(message)
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
    setErrorMessage(null)
    mutation.reset()
    onClose()
  }

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      title={isEdit ? 'Edit Rating' : 'Rate Session'}
      size="sm"
    >
      <div className="space-y-4">
        <p className="text-xs text-fg-muted">
          {isEdit ? 'Update your rating for this session.' : 'Rate this session.'} You can only edit
          your own ratings.
        </p>
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

        {mutation.isError && errorMessage && (
          <p className="rounded-lg bg-error/10 px-3 py-2 text-xs text-error">{errorMessage}</p>
        )}

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
