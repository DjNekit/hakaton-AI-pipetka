import { AuthOtpField, otpFormSchema } from '@/entities/auth'
import { useTranslation } from '@/shared/i18n'

import { useVerifyEmailOtpForm } from './model'

export const VerifyEmailOtp = ({
  form,
  autoFocus,
}: {
  form: ReturnType<typeof useVerifyEmailOtpForm>
  autoFocus?: boolean
}) => {
  const { t } = useTranslation()
  return (
    <form.AppField
      validators={{ onDynamic: otpFormSchema.shape.otp }}
      name={'otp'}
      children={() => (
        <AuthOtpField
          label={t('auth.verifyEmail.otpLabel')}
          autoFocus={autoFocus}
        />
      )}
    />
  )
}
