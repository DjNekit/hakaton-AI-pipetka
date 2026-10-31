import { useTranslation } from '@/shared/i18n'
import { Button } from '@/shared/ui/components/button'
import { SpinnerAddon } from '@/shared/ui/components/spinner-addon'

import { useSendOtp, type EmailFormData, type OtpType } from '../model'

export const ResendOtpButton = ({
  email,
  type,
}: EmailFormData & { type: OtpType }) => {
  const { t } = useTranslation()
  const resend = useSendOtp(type)
  return (
    <Button
      variant={'outline'}
      className={'w-full'}
      disabled={resend.isPending}
      aria-busy={resend.isPending}
      onClick={() => resend.mutate({ email })}
    >
      <SpinnerAddon enabled={resend.isPending} />
      {resend.isSuccess ? t('auth.otp.resent') : t('auth.otp.resendButton')}
    </Button>
  )
}
