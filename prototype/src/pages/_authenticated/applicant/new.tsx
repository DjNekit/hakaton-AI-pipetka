import { createFileRoute } from '@tanstack/react-router'
import { toast } from 'sonner'

import { formatApplicationNumber } from '@/entities/application'
import {
  SubmitApplicationFields,
  useSubmitApplicationForm,
} from '@/features/application/submit'
import { useTranslation } from '@/shared/i18n'

export const Route = createFileRoute('/_authenticated/applicant/new')({
  component: NewApplication,
})

function NewApplication() {
  const { t } = useTranslation()
  const navigate = Route.useNavigate()
  const form = useSubmitApplicationForm({
    onSuccess: application => {
      toast.success(
        t('applicant.submit.success', {
          number: formatApplicationNumber(application.number),
        }),
      )
      void navigate({ to: '/applicant/$id', params: { id: application.id } })
    },
  })

  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-6 px-6 py-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold">{t('applicant.submit.title')}</h1>
        <p className="text-sm text-muted-foreground">
          {t('applicant.submit.description')}
        </p>
      </div>
      <form.AppForm>
        <form.Root className="flex flex-col gap-5">
          <SubmitApplicationFields form={form} />
          <form.Submit className="self-start">
            {t('applicant.submit.submitButton')}
          </form.Submit>
        </form.Root>
      </form.AppForm>
    </main>
  )
}
