import { createFileRoute, Link } from '@tanstack/react-router'

import {
  AuthCard,
  AuthCardForm,
  emailSearchSchema,
  useRedirectAfterAuth,
} from '@/entities/auth'
import {
  SignInEmail,
  SignInPassword,
  useSignInForm,
} from '@/features/auth/sign-in'
import { useTranslation } from '@/shared/i18n'
import { Button } from '@/shared/ui/components/button'

export const Route = createFileRoute('/_auth/sign-in/password')({
  validateSearch: emailSearchSchema,
  component: RouteComponent,
})

function RouteComponent() {
  const { t } = useTranslation()
  const { redirect, email } = Route.useSearch()
  const navigate = Route.useNavigate()
  const redirectAfterAuth = useRedirectAfterAuth()
  const passwordForm = useSignInForm(
    { onSuccess: () => redirectAfterAuth(redirect) },
    email,
  )

  return (
    <passwordForm.AppForm>
      <AuthCard title={t('auth.signIn.title')}>
        <AuthCardForm
          footer={
            <>
              <passwordForm.Submit className={'w-full'}>
                {t('auth.signIn.submitButton')}
              </passwordForm.Submit>
              <Button
                variant={'ghost'}
                className={'w-full'}
                onClick={() =>
                  navigate({ to: '/sign-in', search: { redirect } })
                }
              >
                {t('auth.signIn.otpButton')}
              </Button>
              <Link
                to={'/forgot-password'}
                search={{ redirect }}
                className={
                  'text-sm text-muted-foreground underline-offset-4 hover:underline'
                }
              >
                {t('auth.signIn.forgotPassword')}
              </Link>
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
          <SignInEmail form={passwordForm} autoFocus={!email} />
          <SignInPassword form={passwordForm} autoFocus={Boolean(email)} />
        </AuthCardForm>
      </AuthCard>
    </passwordForm.AppForm>
  )
}
