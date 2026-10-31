import {
  AuthEmailField,
  AuthNameField,
  AuthPasswordField,
} from '@/entities/auth'
import { useTranslation } from '@/shared/i18n'

import { signUpSchema, useSignUpForm } from './model'

export const SignUpName = ({
  form,
  autoFocus,
}: {
  form: ReturnType<typeof useSignUpForm>
  autoFocus?: boolean
}) => {
  const { t } = useTranslation()
  return (
    <form.AppField
      validators={{ onDynamic: signUpSchema.shape.name }}
      name={'name'}
      children={() => (
        <AuthNameField
          label={t('auth.signUp.nameLabel')}
          autoFocus={autoFocus}
        />
      )}
    />
  )
}

export const SignUpEmail = ({
  form,
}: {
  form: ReturnType<typeof useSignUpForm>
}) => {
  const { t } = useTranslation()
  return (
    <form.AppField
      validators={{ onDynamic: signUpSchema.shape.email }}
      name={'email'}
      children={() => <AuthEmailField label={t('auth.signUp.emailLabel')} />}
    />
  )
}

export const SignUpPassword = ({
  form,
}: {
  form: ReturnType<typeof useSignUpForm>
}) => {
  const { t } = useTranslation()
  return (
    <form.AppField
      validators={{ onDynamic: signUpSchema.shape.password }}
      name={'password'}
      children={() => (
        <AuthPasswordField
          label={t('auth.signUp.passwordLabel')}
          autoComplete={'new-password'}
        />
      )}
    />
  )
}
