import {
  emailSchema,
  inlineAuthErrorMeta,
  throwAuthError,
  useAuthFormErrorHandler,
  type AuthError,
} from '@/entities/auth'
import { authClient } from '@/shared/auth-client'
import { z } from '@/shared/i18n'
import { useMutation, type MutationCallbacks } from '@/shared/query'
import { useAppForm } from '@/shared/ui/form'
import { blurFirstValidationLogic } from '@/shared/ui/form'

export const signInSchema = z.object({
  email: emailSchema,
  password: z.string().nonempty(),
})
export type SignInFormData = z.infer<typeof signInSchema>

export type SignInCallbacks = MutationCallbacks<void, AuthError, SignInFormData>

export function useSignIn() {
  return useMutation<void, AuthError, SignInFormData>({
    mutationFn: async value =>
      throwAuthError(await authClient.signIn.email(value)),
    meta: inlineAuthErrorMeta,
    gcTime: 0,
  })
}

export function useSignInForm(callbacks?: SignInCallbacks, defaultEmail = '') {
  const signIn = useSignIn()
  const onAuthError = useAuthFormErrorHandler()
  return useAppForm({
    defaultValues: { email: defaultEmail, password: '' },
    onSubmit: async ({ value, formApi }) => {
      await signIn.mutateAsync(value, callbacks).catch(onAuthError(formApi))
    },
    validationLogic: blurFirstValidationLogic,
  })
}
