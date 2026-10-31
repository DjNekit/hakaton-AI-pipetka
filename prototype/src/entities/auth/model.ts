import { useRouter } from '@tanstack/react-router'

import { authClient } from '@/shared/auth-client'
import { useTranslation, z } from '@/shared/i18n'
import { useMutation, type MutationMeta } from '@/shared/query'

export interface AuthError {
  code?: string
  message?: string
  status: number
  statusText: string
}

export function isAuthError(error: unknown): error is AuthError {
  return (
    typeof error === 'object' &&
    error !== null &&
    !(error instanceof Error) &&
    'status' in error
  )
}

export function throwAuthError({ error }: { error: AuthError | null }) {
  if (error) throw error
}

type Translate = ReturnType<typeof useTranslation>['t']

export function translateAuthError(t: Translate, error: AuthError): string {
  return error.code ? t(`auth.errors.${error.code}` as never) : error.statusText
}

export const inlineAuthErrorMeta = {
  errorMessage: (error: unknown) => (isAuthError(error) ? false : undefined),
} satisfies MutationMeta

export function useAuthToastErrorMeta(): MutationMeta {
  const { t } = useTranslation()
  return {
    errorMessage: error =>
      isAuthError(error) && error.code
        ? translateAuthError(t, error)
        : undefined,
  }
}

interface AuthFormApi {
  setErrorMap: (errorMap: {
    onSubmit: { form: string; fields: Record<string, never> }
  }) => void
}

export function useAuthFormErrorHandler() {
  const { t } = useTranslation()
  return (formApi: AuthFormApi) => (error: unknown) => {
    if (!isAuthError(error)) return
    formApi.setErrorMap({
      onSubmit: { form: translateAuthError(t, error), fields: {} },
    })
  }
}

export const emailSchema = z.string().nonempty().pipe(z.string().email())
export const passwordSchema = z
  .string()
  .nonempty()
  .pipe(z.string().min(8).max(128))
export const otpCodeSchema = z
  .string()
  .nonempty()
  .pipe(z.string().regex(/^\d{6}$/))

export const emailFormSchema = z.object({
  email: emailSchema,
})
export type EmailFormData = z.infer<typeof emailFormSchema>

export const otpFormSchema = z.object({
  otp: otpCodeSchema,
})
export type OtpFormData = z.infer<typeof otpFormSchema>

export type EmailOtpData = OtpFormData & EmailFormData

export type OtpType = 'sign-in' | 'email-verification'

export function useSendOtp(type: OtpType) {
  const meta = useAuthToastErrorMeta()
  return useMutation<void, AuthError, EmailFormData>({
    mutationFn: async ({ email }) =>
      throwAuthError(
        await authClient.emailOtp.sendVerificationOtp({ email, type }),
      ),
    meta,
  })
}

export const authSearchSchema = z.object({
  redirect: z.string().optional().catch(undefined),
})

export const emailSearchSchema = authSearchSchema.extend({
  email: z.string().optional().catch(undefined),
})

export const resetPasswordSearchSchema = emailSearchSchema.extend({
  token: z.string().optional().catch(undefined),
  error: z.string().optional().catch(undefined),
})

function isSafeRedirectPath(path?: string): path is string {
  return (
    !!path &&
    path.startsWith('/') &&
    !path.startsWith('//') &&
    !path.includes('://')
  )
}

export function resolveRedirectPath(redirect?: string): string {
  return isSafeRedirectPath(redirect) ? redirect : '/'
}

export function useRedirectAfterAuth() {
  const router = useRouter()
  return (redirect?: string) =>
    router.navigate({ href: resolveRedirectPath(redirect) })
}
