import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'

import {
  AiReviewPanel,
  ApplicationNumber,
  applicationQueryOptions,
  ApplicationProperties,
  type Application,
} from '@/entities/application'
import { ReviewFields, useReviewForm } from '@/features/application/review'
import { useTranslation } from '@/shared/i18n'
import { Skeleton } from '@/shared/ui/components/skeleton'

function ReviewForm({ application }: { application: Application }) {
  const { t } = useTranslation()
  const form = useReviewForm(application, {
    onSuccess: () => toast.success(t('approver.review.saved')),
  })
  return (
    <form.AppForm>
      <form.Root className="flex flex-col gap-4">
        <ReviewFields form={form} />
        <form.Submit className="self-start">
          {t('approver.review.saveButton')}
        </form.Submit>
      </form.Root>
    </form.AppForm>
  )
}

export function ApplicationHeading({
  application,
}: {
  application: Application
}) {
  return (
    <div className="flex flex-col gap-1">
      <ApplicationNumber number={application.number} />
      <h1 className="text-xl font-semibold">{application.address}</h1>
      {application.description && (
        <p className="text-sm whitespace-pre-wrap text-muted-foreground">
          {application.description}
        </p>
      )}
    </div>
  )
}

export function ApplicationReview({
  id,
  layout,
}: {
  id: string
  layout: 'page' | 'sheet'
}) {
  const { t } = useTranslation()
  const { data, isPending, isError } = useQuery(applicationQueryOptions(id))

  if (isPending) return <Skeleton className="h-64" />
  if (isError) {
    return <p className="text-destructive">{t('application.notFound')}</p>
  }

  const properties = <ApplicationProperties application={data} showApplicant />
  const aiReview = (
    <section className="flex min-w-0 flex-col gap-3">
      <h2 className="text-sm font-medium">{t('application.aiReview.title')}</h2>
      <AiReviewPanel
        review={data.aiReview}
        checking={data.status === 'ai_check'}
      />
    </section>
  )
  const decision = data.status !== 'ai_check' && (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-medium">{t('approver.review.title')}</h2>
      <ReviewForm key={data.updatedAt} application={data} />
    </section>
  )

  if (layout === 'sheet') {
    return (
      <div className="flex flex-col gap-8">
        {properties}
        {aiReview}
        {decision}
      </div>
    )
  }
  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_20rem]">
      <div className="flex min-w-0 flex-col gap-6">
        <ApplicationHeading application={data} />
        {aiReview}
      </div>
      <aside className="flex flex-col gap-6 lg:border-l lg:pl-8">
        {properties}
        {decision}
      </aside>
    </div>
  )
}
