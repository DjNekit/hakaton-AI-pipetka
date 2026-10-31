import {
  throwAuthError,
  useAuthToastErrorMeta,
  type AuthError,
} from '@/entities/auth'
import { authClient } from '@/shared/auth-client'
import { useMutation, type MutationCallbacks } from '@/shared/query'

export type SignOutCallbacks = MutationCallbacks<void, AuthError, void>

export function useSignOut() {
  const meta = useAuthToastErrorMeta()
  return useMutation<void, AuthError, void>({
    mutationFn: async () => throwAuthError(await authClient.signOut()),
    meta,
  })
}
