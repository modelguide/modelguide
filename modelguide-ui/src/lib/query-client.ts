import { QueryClient } from '@tanstack/react-query'
import { HTTPError } from 'ky'
import { toast } from 'sonner'

function handleGlobalError(error: unknown) {
  if (error instanceof HTTPError) {
    if (error.response.status === 403) {
      toast.error("You don't have permission to perform this action")
    } else if (error.response.status >= 500) {
      toast.error('Something went wrong. Please try again.')
    }
  }
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60, // 1 minute
      retry: 1,
    },
    mutations: {
      onError: handleGlobalError,
    },
  },
})
