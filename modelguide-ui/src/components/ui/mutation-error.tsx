interface MutationErrorProps {
  error: Error | null | undefined
  fallback?: string
  className?: string
}

/**
 * Renders a mutation error message, extracting the message from Error instances
 * or falling back to a default string.
 */
export function MutationError({
  error,
  fallback = 'Something went wrong',
  className,
}: MutationErrorProps) {
  if (!error) return null

  return (
    <p className={className ?? 'font-sans text-sm text-error'}>
      {error instanceof Error ? error.message : fallback}
    </p>
  )
}
