import { IconArrowLeft } from '@tabler/icons-react'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'

import {
  ApplicationNumber,
  applicationQueryOptions,
  ApplicationProperties,
} from '@/entities/application'
import { useTranslation } from '@/shared/i18n'
import { Skeleton } from '@/shared/ui/components/skeleton'

export const Route = createFileRoute('/_authenticated/applicant/$id')({
  component: ApplicationPage,
})

function ApplicationPage() {
  const { t } = useTranslation()
  const { id } = Route.useParams()
  const { data, isPending, isError } = useQuery(applicationQueryOptions(id))

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6 sm:px-6">
      <Link
        to="/applicant"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <IconArrowLeft className="size-4" />
        {t('application.back')}
      </Link>
      {isPending && <Skeleton className="h-40" />}
      {isError && (
        <p className="text-destructive">{t('application.notFound')}</p>
      )}
      {data && (
        <>
          <div className="flex flex-col gap-1">
            <ApplicationNumber number={data.number} />
            <h1 className="text-xl font-semibold">{data.address}</h1>
            {data.description && (
              <p className="text-sm whitespace-pre-wrap text-muted-foreground">
                {data.description}
              </p>
            )}
          </div>
          <ApplicationProperties application={data} />
          <section className="flex flex-col gap-2 rounded-lg border p-4">
            <h2 className="text-sm font-medium">
              {t('application.fields.reviewComment')}
            </h2>
            <p className="text-sm whitespace-pre-wrap text-muted-foreground">
              {data.reviewComment || t('application.noReviewComment')}
            </p>
          </section>
        </>
      )}
    </main>
  )
}
