import {
  AuthEmailField,
  AuthOtpField,
  emailFormSchema,
  otpFormSchema,
} from '@/entities/auth'
import { useTranslation } from '@/shared/i18n'

import { useSignInOtpForm, useSignInOtpRequestForm } from './model'

export const SignInOtpEmail = ({
  form,
  autoFocus,
}: {
  form: ReturnType<typeof useSignInOtpRequestForm>
  autoFocus?: boolean
}) => {
  const { t } = useTranslation()
  return (
    <form.AppField
      validators={{ onDynamic: emailFormSchema.shape.email }}
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

export const SignInOtpCode = ({
  form,
  autoFocus,
}: {
  form: ReturnType<typeof useSignInOtpForm>
  autoFocus?: boolean
}) => {
  const { t } = useTranslation()
  return (
    <form.AppField
      validators={{ onDynamic: otpFormSchema.shape.otp }}
      name={'otp'}
      children={() => (
        <AuthOtpField label={t('auth.signIn.otpLabel')} autoFocus={autoFocus} />
      )}
    />
  )
}
