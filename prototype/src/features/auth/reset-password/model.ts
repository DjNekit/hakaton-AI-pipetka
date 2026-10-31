import {
  inlineAuthErrorMeta,
  passwordSchema,
  throwAuthError,
  useAuthFormErrorHandler,
  type AuthError,
} from '@/entities/auth'
import { authClient } from '@/shared/auth-client'
import { z } from '@/shared/i18n'
import { useMutation, type MutationCallbacks } from '@/shared/query'
import { useAppForm } from '@/shared/ui/form'
import { blurFirstValidationLogic } from '@/shared/ui/form'

export const resetPasswordSchema = z.object({
  password: passwordSchema,
})
export type ResetPasswordFormData = z.infer<typeof resetPasswordSchema>

export interface ResetPasswordData extends ResetPasswordFormData {
  token: string
}

export type ResetPasswordCallbacks = MutationCallbacks<
  void,
  AuthError,
  ResetPasswordData
>

export function useResetPassword() {
  return useMutation<void, AuthError, ResetPasswordData>({
    mutationFn: async ({ password, token }) =>
      throwAuthError(
        await authClient.resetPassword({ newPassword: password, token }),
      ),
    meta: inlineAuthErrorMeta,
    gcTime: 0,
  })
}

export function useResetPasswordForm(
  token: string,
  callbacks?: ResetPasswordCallbacks,
) {
  const resetPassword = useResetPassword()
  const onAuthError = useAuthFormErrorHandler()
  return useAppForm({
    defaultValues: { password: '' },
    onSubmit: async ({ value, formApi }) => {
      await resetPassword
        .mutateAsync({ ...value, token }, callbacks)
        .catch(onAuthError(formApi))
    },
    validationLogic: blurFirstValidationLogic,
  })
}
