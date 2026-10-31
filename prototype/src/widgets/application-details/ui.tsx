import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { toast } from 'sonner'

import {
  ApplicationNumber,
  applicationQueryOptions,
  ApplicationProperties,
  ApproverConclusion,
  checklistQueryOptions,
  DecisionCard,
  ReviewComparison,
  VersionHistory,
  type Application,
  type ChecklistItem,
} from '@/entities/application'
import type { Role } from '@/entities/auth'
import {
  ApproverReviewFields,
  useApproverReviewForm,
} from '@/features/application/approver-review'
import { DecisionFields, useDecisionForm } from '@/features/application/decide'
import { useTranslation } from '@/shared/i18n'
import { Skeleton } from '@/shared/ui/components/skeleton'

export type StaffRole = Exclude<Role, 'applicant'>

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col gap-3">
      <h2 className="text-sm font-medium">{title}</h2>
      {children}
    </section>
  )
}

function ReviewForm({
  application,
  checklist,
}: {
  application: Application
  checklist: ChecklistItem[]
}) {
  const { t } = useTranslation()
  const form = useApproverReviewForm(application, checklist, {
    onSuccess: () => toast.success(t('approver.review.submitted')),
  })
  return (
    <form.AppForm>
      <form.Root className="flex flex-col gap-6">
        <ApproverReviewFields form={form} checklist={checklist} />
        <form.Submit className="self-start">
          {t('approver.review.submitButton')}
        </form.Submit>
      </form.Root>
    </form.AppForm>
  )
}

function ApproverWork({ application }: { application: Application }) {
  const { t } = useTranslation()
  const canReview =
    application.status === 'review' && !application.approverReview
  const checklist = useQuery({
    ...checklistQueryOptions(application.id),
    enabled: canReview,
  })

  return (
    <Section title={t('approver.review.title')}>
      {canReview && (
        <>
          <p className="text-sm text-muted-foreground">
            {t('approver.review.hint')}
          </p>
          {checklist.data ? (
            <ReviewForm application={application} checklist={checklist.data} />
          ) : (
            <Skeleton className="h-64" />
          )}
        </>
      )}
      {application.approverReview && (
        <ApproverConclusion review={application.approverReview} />
      )}
      {!canReview && !application.approverReview && (
        <p className="text-sm text-muted-foreground">
          {t(
            application.status === 'ai_check'
              ? 'approver.review.waitingAi'
              : 'approver.review.locked',
          )}
        </p>
      )}
    </Section>
  )
}

function DecisionForm({ application }: { application: Application }) {
  const { t } = useTranslation()
  const form = useDecisionForm(application, {
    onSuccess: () => toast.success(t('normcontrol.decide.done')),
  })
  return (
    <form.AppForm>
      <form.Root>
        <DecisionFields form={form} />
      </form.Root>
    </form.AppForm>
  )
}

function NormcontrolWork({ application }: { application: Application }) {
  const { t } = useTranslation()
  const { aiReview, approverReview } = application
  const aiDone = aiReview?.state === 'done' || aiReview?.state === 'failed'

  return (
    <>
      {(application.status === 'ai_check' ||
        application.status === 'review') && (
        <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
          {t(
            application.status === 'ai_check'
              ? 'normcontrol.compare.waitingAi'
              : 'normcontrol.compare.waitingApprover',
          )}
        </p>
      )}
      {approverReview && (
        <Section title={t('normcontrol.compare.approverConclusion')}>
          <ApproverConclusion review={approverReview} />
        </Section>
      )}
      {aiReview?.summary && (
        <Section title={t('normcontrol.compare.aiSummary')}>
          <p className="text-sm">{aiReview.summary}</p>
        </Section>
      )}
      {(aiDone || approverReview) && (
        <Section title={t('normcontrol.compare.title')}>
          <ReviewComparison
            ai={aiDone ? aiReview : null}
            approver={approverReview}
          />
        </Section>
      )}
    </>
  )
}

function DecisionBlock({
  application,
  role,
}: {
  application: Application
  role: StaffRole
}) {
  const { t } = useTranslation()
  if (role === 'normcontrol' && application.status === 'normcontrol') {
    return (
      <Section title={t('normcontrol.decide.title')}>
        <DecisionForm application={application} />
      </Section>
    )
  }
  if (!application.decision) return null
  return (
    <Section title={t('application.decision.title')}>
      <DecisionCard decision={application.decision} />
    </Section>
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
  role,
  layout,
}: {
  id: string
  role: StaffRole
  layout: 'page' | 'panel'
}) {
  const { t } = useTranslation()
  const { data, isPending, isError } = useQuery(applicationQueryOptions(id))

  if (isPending) return <Skeleton className="h-64" />
  if (isError) {
    return <p className="text-destructive">{t('application.notFound')}</p>
  }

  const properties = <ApplicationProperties application={data} showApplicant />
  const work =
    role === 'approver' ? (
      <ApproverWork key={data.status} application={data} />
    ) : (
      <NormcontrolWork application={data} />
    )
  const decision = <DecisionBlock application={data} role={role} />
  const history = (
    <Section title={t('application.versions.title')}>
      <VersionHistory application={data} showSummary={role === 'normcontrol'} />
    </Section>
  )

  if (layout === 'panel') {
    return (
      <div className="flex flex-col gap-8">
        {properties}
        {work}
        {decision}
        {history}
      </div>
    )
  }
  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_20rem]">
      <div className="flex min-w-0 flex-col gap-6">
        <ApplicationHeading application={data} />
        {work}
      </div>
      <aside className="flex flex-col gap-6 lg:border-l lg:pl-8">
        {properties}
        {decision}
        {history}
      </aside>
    </div>
  )
}
