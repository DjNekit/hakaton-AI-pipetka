import { AuthEmailField, emailFormSchema } from '@/entities/auth'
import { useTranslation } from '@/shared/i18n'

import { useForgotPasswordForm } from './model'

export const ForgotPasswordEmail = ({
  form,
  autoFocus,
}: {
  form: ReturnType<typeof useForgotPasswordForm>
  autoFocus?: boolean
}) => {
  const { t } = useTranslation()
  return (
    <form.AppField
      validators={{ onDynamic: emailFormSchema.shape.email }}
      name={'email'}
      children={() => (
        <AuthEmailField
          label={t('auth.forgotPassword.emailLabel')}
          autoFocus={autoFocus}
        />
      )}
    />
  )
}
