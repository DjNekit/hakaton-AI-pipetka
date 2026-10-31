import {
  emailSchema,
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

export const signUpSchema = z.object({
  name: z.string().nonempty(),
  email: emailSchema,
  password: passwordSchema,
})
export type SignUpFormData = z.infer<typeof signUpSchema>

export type SignUpCallbacks = MutationCallbacks<void, AuthError, SignUpFormData>

export function useSignUp() {
  return useMutation<void, AuthError, SignUpFormData>({
    mutationFn: async value =>
      throwAuthError(await authClient.signUp.email(value)),
    meta: inlineAuthErrorMeta,
    gcTime: 0,
  })
}

export function useSignUpForm(callbacks?: SignUpCallbacks) {
  const signUp = useSignUp()
  const onAuthError = useAuthFormErrorHandler()
  return useAppForm({
    defaultValues: { name: '', email: '', password: '' },
    onSubmit: async ({ value, formApi }) => {
      await signUp.mutateAsync(value, callbacks).catch(onAuthError(formApi))
    },
    validationLogic: blurFirstValidationLogic,
  })
}
