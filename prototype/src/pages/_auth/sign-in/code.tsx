import {
  createFileRoute,
  redirect as routerRedirect,
} from '@tanstack/react-router'

import {
  AuthCard,
  AuthCardForm,
  emailSearchSchema,
  ResendOtpButton,
  useRedirectAfterAuth,
} from '@/entities/auth'
import { SignInOtpCode, useSignInOtpForm } from '@/features/auth/sign-in-otp'
import { useTranslation } from '@/shared/i18n'
import { Button } from '@/shared/ui/components/button'
import { CardFooter } from '@/shared/ui/components/card'

export const Route = createFileRoute('/_auth/sign-in/code')({
  validateSearch: emailSearchSchema,
  beforeLoad: ({ search }) => {
    if (!search.email) {
      throw routerRedirect({
        to: '/sign-in',
        search: { redirect: search.redirect },
      })
    }
  },
  component: RouteComponent,
})

function RouteComponent() {
  const { t } = useTranslation()
  const { redirect, email: emailParam } = Route.useSearch()
  const email = emailParam ?? ''
  const navigate = Route.useNavigate()
  const redirectAfterAuth = useRedirectAfterAuth()
  const otpForm = useSignInOtpForm(email, {
    onSuccess: () => redirectAfterAuth(redirect),
  })

  return (
    <otpForm.AppForm>
      <AuthCard
        title={t('auth.signIn.title')}
        description={t('auth.signIn.otpCodeDescription', { email })}
      >
        <AuthCardForm
          footer={
            <otpForm.Submit className={'w-full'}>
              {t('auth.signIn.submitButton')}
            </otpForm.Submit>
          }
        >
          <SignInOtpCode form={otpForm} autoFocus />
        </AuthCardForm>
        <CardFooter className={'flex-col gap-4'}>
          <ResendOtpButton email={email} type={'sign-in'} />
          <Button
            variant={'ghost'}
            className={'w-full'}
            onClick={() =>
              navigate({ to: '/sign-in/password', search: { redirect, email } })
            }
          >
            {t('auth.signIn.usePasswordButton')}
          </Button>
        </CardFooter>
      </AuthCard>
    </otpForm.AppForm>
  )
}
