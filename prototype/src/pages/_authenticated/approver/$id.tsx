import { IconArrowLeft } from '@tabler/icons-react'
import { createFileRoute, Link } from '@tanstack/react-router'

import { useTranslation } from '@/shared/i18n'
import { ApplicationReview } from '@/widgets/application-details'

export const Route = createFileRoute('/_authenticated/approver/$id')({
  component: ApplicationPage,
})

function ApplicationPage() {
  const { t } = useTranslation()
  const { id } = Route.useParams()

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6">
      <Link
        to="/approver"
        className="inline-flex items-center gap-1 self-start text-sm text-muted-foreground hover:text-foreground"
      >
        <IconArrowLeft className="size-4" />
        {t('application.back')}
      </Link>
      <ApplicationReview id={id} layout="page" />
    </main>
  )
}
