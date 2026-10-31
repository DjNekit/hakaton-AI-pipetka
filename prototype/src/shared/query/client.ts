import { MutationCache, QueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

export type MutationMeta = {
  errorMessage?:
    | string
    | ((error: unknown) => string | false | undefined)
    | false
}

declare module '@tanstack/react-query' {
  interface Register {
    mutationMeta: MutationMeta
  }
}

function resolveErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return String(error.message)
  }
  return String(error)
}

export function createAppQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
      },
    },
    mutationCache: new MutationCache({
      onError: (error, _variables, _context, mutation) => {
        const { errorMessage } = mutation.meta ?? {}
        if (errorMessage === false) return
        const resolved =
          typeof errorMessage === 'function'
            ? errorMessage(error)
            : errorMessage
        if (resolved === false) return
        toast.error(resolved ?? resolveErrorMessage(error))
      },
    }),
  })
}
