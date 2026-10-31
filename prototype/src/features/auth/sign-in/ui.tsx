import { AuthEmailField, AuthPasswordField } from '@/entities/auth'
import { useTranslation } from '@/shared/i18n'

import { signInSchema, useSignInForm } from './model'

export const SignInEmail = ({
  form,
  autoFocus,
}: {
  form: ReturnType<typeof useSignInForm>
  autoFocus?: boolean
}) => {
  const { t } = useTranslation()
  return (
    <form.AppField
      validators={{ onDynamic: signInSchema.shape.email }}
      name={'email'}
      children={() => (
        <AuthEmailField
          label={t('auth.signIn.emailLabel')}
          autoFocus={autoFocus}
        />
      )}
    />
  )
}

export const SignInPassword = ({
  form,
  autoFocus,
}: {
  form: ReturnType<typeof useSignInForm>
  autoFocus?: boolean
}) => {
  const { t } = useTranslation()
  return (
    <form.AppField
      validators={{ onDynamic: signInSchema.shape.password }}
      name={'password'}
      children={() => (
        <AuthPasswordField
          label={t('auth.signIn.passwordLabel')}
          autoComplete={'current-password'}
          autoFocus={autoFocus}
        />
      )}
    />
  )
}
