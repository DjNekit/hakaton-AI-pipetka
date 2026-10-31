import { createFileRoute, Link } from '@tanstack/react-router'

import { AuthCard, AuthCardForm, authSearchSchema } from '@/entities/auth'
import {
  SignUpEmail,
  SignUpName,
  SignUpPassword,
  useSignUpForm,
} from '@/features/auth/sign-up'
import { useTranslation } from '@/shared/i18n'

export const Route = createFileRoute('/_auth/sign-up')({
  validateSearch: authSearchSchema,
  component: RouteComponent,
})

function RouteComponent() {
  const { t } = useTranslation()
  const { redirect } = Route.useSearch()
  const navigate = Route.useNavigate()
  const form = useSignUpForm({
    onSuccess: (_data, { email }) =>
      navigate({ to: '/verify-email', search: { email, redirect } }),
  })
  return (
    <form.AppForm>
      <AuthCard title={t('auth.signUp.title')}>
        <AuthCardForm
          footer={
            <>
              <form.Submit className={'w-full'}>
                {t('auth.signUp.submitButton')}
              </form.Submit>
              <p className={'text-sm text-muted-foreground'}>
                {t('auth.signUp.haveAccount')}{' '}
                <Link
                  to={'/sign-in'}
                  search={{ redirect }}
                  className={
                    'text-foreground underline-offset-4 hover:underline'
                  }
                >
                  {t('auth.signUp.signInLink')}
                </Link>
              </p>
            </>
          }
        >
          <SignUpName form={form} autoFocus />
          <SignUpEmail form={form} />
          <SignUpPassword form={form} />
        </AuthCardForm>
      </AuthCard>
    </form.AppForm>
  )
}
