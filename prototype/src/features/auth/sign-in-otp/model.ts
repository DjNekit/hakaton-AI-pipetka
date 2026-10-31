import {
  inlineAuthErrorMeta,
  throwAuthError,
  useAuthFormErrorHandler,
  useSendOtp,
  type AuthError,
  type EmailFormData,
  type EmailOtpData,
} from '@/entities/auth'
import { authClient } from '@/shared/auth-client'
import { useMutation, type MutationCallbacks } from '@/shared/query'
import { useAppForm } from '@/shared/ui/form'
import { blurFirstValidationLogic } from '@/shared/ui/form'

export type SendSignInOtpCallbacks = MutationCallbacks<
  void,
  AuthError,
  EmailFormData
>

export function useSignInOtpRequestForm(callbacks?: SendSignInOtpCallbacks) {
  const sendOtp = useSendOtp('sign-in')
  return useAppForm({
    defaultValues: { email: '' },
    onSubmit: async ({ value }) => {
      await sendOtp.mutateAsync(value, callbacks).catch(() => undefined)
    },
    validationLogic: blurFirstValidationLogic,
  })
}

export type SignInOtpCallbacks = MutationCallbacks<
  void,
  AuthError,
  EmailOtpData
>

export function useSignInOtp() {
  return useMutation<void, AuthError, EmailOtpData>({
    mutationFn: async value =>
      throwAuthError(await authClient.signIn.emailOtp(value)),
    meta: inlineAuthErrorMeta,
    gcTime: 0,
  })
}

export function useSignInOtpForm(
  email: string,
  callbacks?: SignInOtpCallbacks,
) {
  const signInOtp = useSignInOtp()
  const onAuthError = useAuthFormErrorHandler()
  return useAppForm({
    defaultValues: { otp: '' },
    onSubmit: async ({ value, formApi }) => {
      await signInOtp
        .mutateAsync({ ...value, email }, callbacks)
        .catch(onAuthError(formApi))
    },
    validationLogic: blurFirstValidationLogic,
  })
}
