import { createFileRoute, Link } from '@tanstack/react-router'

import { AuthCard, AuthCardForm, authSearchSchema } from '@/entities/auth'
import {
  SignInOtpEmail,
  useSignInOtpRequestForm,
} from '@/features/auth/sign-in-otp'
import { useTranslation } from '@/shared/i18n'
import { Button } from '@/shared/ui/components/button'

export const Route = createFileRoute('/_auth/sign-in/')({
  validateSearch: authSearchSchema,
  component: RouteComponent,
})

function RouteComponent() {
  const { t } = useTranslation()
  const { redirect } = Route.useSearch()
  const navigate = Route.useNavigate()
  const emailForm = useSignInOtpRequestForm({
    onSuccess: (_data, { email }) =>
      navigate({ to: '/sign-in/code', search: { redirect, email } }),
  })

  const usePassword = () =>
    navigate({
      to: '/sign-in/password',
      search: {
        redirect,
        email: emailForm.getFieldValue('email') || undefined,
      },
    })

  return (
    <emailForm.AppForm>
      <AuthCard
        title={t('auth.signIn.title')}
        description={t('auth.signIn.otpEmailDescription')}
      >
        <AuthCardForm
          footer={
            <>
              <emailForm.Submit className={'w-full'}>
                {t('auth.signIn.continueButton')}
              </emailForm.Submit>
              <Button
                variant={'ghost'}
                className={'w-full'}
                onClick={usePassword}
              >
                {t('auth.signIn.usePasswordButton')}
              </Button>
              <p className={'text-sm text-muted-foreground'}>
                {t('auth.signIn.noAccount')}{' '}
                <Link
                  to={'/sign-up'}
                  search={{ redirect }}
                  className={
                    'text-foreground underline-offset-4 hover:underline'
                  }
                >
                  {t('auth.signIn.signUpLink')}
                </Link>
              </p>
            </>
          }
        >
          <SignInOtpEmail form={emailForm} autoFocus />
        </AuthCardForm>
      </AuthCard>
    </emailForm.AppForm>
  )
}
