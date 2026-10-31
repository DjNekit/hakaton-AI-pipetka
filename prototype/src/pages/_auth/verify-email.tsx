import { createFileRoute, Link } from '@tanstack/react-router'

import {
  AuthCard,
  AuthCardForm,
  emailSearchSchema,
  ResendOtpButton,
  useRedirectAfterAuth,
} from '@/entities/auth'
import {
  useVerifyEmailOtpForm,
  VerifyEmailOtp,
} from '@/features/auth/verify-email'
import { useTranslation } from '@/shared/i18n'
import { CardFooter } from '@/shared/ui/components/card'

export const Route = createFileRoute('/_auth/verify-email')({
  validateSearch: emailSearchSchema,
  component: RouteComponent,
})

function RouteComponent() {
  const { t } = useTranslation()
  const { email, redirect } = Route.useSearch()
  const redirectAfterAuth = useRedirectAfterAuth()
  const form = useVerifyEmailOtpForm(email ?? '', {
    onSuccess: () => redirectAfterAuth(redirect),
  })

  return (
    <form.AppForm>
      <AuthCard
        title={t('auth.verifyEmail.title')}
        description={
          email
            ? t('auth.verifyEmail.description', { email })
            : t('auth.verifyEmail.descriptionFallback')
        }
      >
        {email && (
          <AuthCardForm
            footer={
              <form.Submit className={'w-full'}>
                {t('auth.verifyEmail.verifyOtpButton')}
              </form.Submit>
            }
          >
            <VerifyEmailOtp form={form} autoFocus />
          </AuthCardForm>
        )}
        <CardFooter className={'flex-col gap-4'}>
          {email && (
            <ResendOtpButton email={email} type={'email-verification'} />
          )}
          <Link
            to={'/sign-in'}
            search={{ redirect }}
            className={
              'text-sm text-muted-foreground underline-offset-4 hover:underline'
            }
          >
            {t('auth.verifyEmail.backToSignIn')}
          </Link>
        </CardFooter>
      </AuthCard>
    </form.AppForm>
  )
}
