import { createFileRoute, Link } from '@tanstack/react-router'
import { useState } from 'react'

import { AuthCard, AuthCardForm, authSearchSchema } from '@/entities/auth'
import {
  ForgotPasswordEmail,
  useForgotPasswordForm,
} from '@/features/auth/forgot-password'
import { useTranslation } from '@/shared/i18n'
import { CardFooter } from '@/shared/ui/components/card'

export const Route = createFileRoute('/_auth/forgot-password')({
  validateSearch: authSearchSchema,
  component: RouteComponent,
})

function RouteComponent() {
  const { t } = useTranslation()
  const { redirect } = Route.useSearch()
  const [sentTo, setSentTo] = useState<string>()
  const origin =
    typeof window !== 'undefined'
      ? window.location.origin
      : process.env.BETTER_AUTH_URL!
  const redirectTo = new URL('/reset-password', origin)
  if (redirect) redirectTo.searchParams.set('redirect', redirect)
  const form = useForgotPasswordForm(redirectTo.toString(), {
    onSuccess: (_data, { email }) => setSentTo(email),
  })

  const backToSignIn = (
    <Link
      to={'/sign-in/password'}
      search={{ redirect }}
      className={
        'text-sm text-muted-foreground underline-offset-4 hover:underline'
      }
    >
      {t('auth.forgotPassword.backToSignIn')}
    </Link>
  )

  if (sentTo) {
    return (
      <AuthCard
        title={t('auth.forgotPassword.title')}
        description={t('auth.forgotPassword.sentDescription', {
          email: sentTo,
        })}
      >
        <CardFooter className={'flex-col gap-4'}>{backToSignIn}</CardFooter>
      </AuthCard>
    )
  }

  return (
    <form.AppForm>
      <AuthCard
        title={t('auth.forgotPassword.title')}
        description={t('auth.forgotPassword.description')}
      >
        <AuthCardForm
          footer={
            <>
              <form.Submit className={'w-full'}>
                {t('auth.forgotPassword.submitButton')}
              </form.Submit>
              {backToSignIn}
            </>
          }
        >
          <ForgotPasswordEmail form={form} autoFocus />
        </AuthCardForm>
      </AuthCard>
    </form.AppForm>
  )
}
