import {
  inlineAuthErrorMeta,
  throwAuthError,
  useAuthFormErrorHandler,
  type AuthError,
  type EmailFormData,
} from '@/entities/auth'
import { authClient } from '@/shared/auth-client'
import { useMutation, type MutationCallbacks } from '@/shared/query'
import { useAppForm } from '@/shared/ui/form'
import { blurFirstValidationLogic } from '@/shared/ui/form'

export interface RequestPasswordResetData extends EmailFormData {
  redirectTo: string
}

export type ForgotPasswordCallbacks = MutationCallbacks<
  void,
  AuthError,
  RequestPasswordResetData
>

export function useRequestPasswordReset() {
  return useMutation<void, AuthError, RequestPasswordResetData>({
    mutationFn: async ({ email, redirectTo }) => {
      const url = new URL(redirectTo)
      url.searchParams.set('email', email)
      throwAuthError(
        await authClient.requestPasswordReset({
          email,
          redirectTo: url.toString(),
        }),
      )
    },
    meta: inlineAuthErrorMeta,
  })
}

export function useForgotPasswordForm(
  redirectTo: string,
  callbacks?: ForgotPasswordCallbacks,
) {
  const requestPasswordReset = useRequestPasswordReset()
  const onAuthError = useAuthFormErrorHandler()
  return useAppForm({
    defaultValues: { email: '' },
    onSubmit: async ({ value, formApi }) => {
      await requestPasswordReset
        .mutateAsync({ ...value, redirectTo }, callbacks)
        .catch(onAuthError(formApi))
    },
    validationLogic: blurFirstValidationLogic,
  })
}
