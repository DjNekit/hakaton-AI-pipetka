import {
  inlineAuthErrorMeta,
  throwAuthError,
  useAuthFormErrorHandler,
  type AuthError,
  type EmailOtpData,
} from '@/entities/auth'
import { authClient } from '@/shared/auth-client'
import { useMutation, type MutationCallbacks } from '@/shared/query'
import { useAppForm } from '@/shared/ui/form'
import { blurFirstValidationLogic } from '@/shared/ui/form'

export type VerifyEmailOtpCallbacks = MutationCallbacks<
  void,
  AuthError,
  EmailOtpData
>

export function useVerifyEmailOtp() {
  return useMutation<void, AuthError, EmailOtpData>({
    mutationFn: async value =>
      throwAuthError(await authClient.emailOtp.verifyEmail(value)),
    meta: inlineAuthErrorMeta,
    gcTime: 0,
  })
}

export function useVerifyEmailOtpForm(
  email: string,
  callbacks?: VerifyEmailOtpCallbacks,
) {
  const verifyEmailOtp = useVerifyEmailOtp()
  const onAuthError = useAuthFormErrorHandler()
  return useAppForm({
    defaultValues: { otp: '' },
    onSubmit: async ({ value, formApi }) => {
      await verifyEmailOtp
        .mutateAsync({ ...value, email }, callbacks)
        .catch(onAuthError(formApi))
    },
    validationLogic: blurFirstValidationLogic,
  })
}
