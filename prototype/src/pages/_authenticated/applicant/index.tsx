import { IconPlus } from '@tabler/icons-react'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'

import { applicationsQueryOptions } from '@/entities/application'
import { useTranslation } from '@/shared/i18n'
import { buttonVariants } from '@/shared/ui/components/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/shared/ui/components/empty'
import { Skeleton } from '@/shared/ui/components/skeleton'
import { ApplicationsTable } from '@/widgets/applications-table'

export const Route = createFileRoute('/_authenticated/applicant/')({
  component: MyApplications,
})

function MyApplications() {
  const { t } = useTranslation()
  const { data, isPending, isError } = useQuery(applicationsQueryOptions())

  return (
    <main className="flex flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
        <h1 className="text-lg font-semibold">{t('applicant.list.title')}</h1>
        <Link to="/applicant/new" className={buttonVariants({ size: 'sm' })}>
          <IconPlus />
          {t('nav.newApplication')}
        </Link>
      </div>
      {isPending && (
        <div className="flex flex-col gap-2 px-4 sm:px-6">
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </div>
      )}
      {isError && (
        <p className="px-4 text-destructive sm:px-6">
          {t('application.loadError')}
        </p>
      )}
      {data && data.length === 0 && (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{t('applicant.list.emptyTitle')}</EmptyTitle>
            <EmptyDescription>
              {t('applicant.list.emptyDescription')}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Link to="/applicant/new" className={buttonVariants()}>
              {t('nav.newApplication')}
            </Link>
          </EmptyContent>
        </Empty>
      )}
      {data && data.length > 0 && (
        <ApplicationsTable applications={data} detailRoute="/applicant/$id" />
      )}
    </main>
  )
}
