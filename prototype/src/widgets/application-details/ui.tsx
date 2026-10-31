import { useQuery } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import { toast } from 'sonner'

import {
  ApplicationNumber,
  applicationQueryOptions,
  ApplicationProperties,
  ApplicationSheetViewer,
  ApproverConclusion,
  checklistQueryOptions,
  DecisionCard,
  ReviewComparison,
  VersionHistory,
  type Application,
  type ChecklistItem,
  type SheetSelection,
  type FindingLocation,
} from '@/entities/application'
import type { Role } from '@/entities/auth'
import {
  ApproverReviewFields,
  useApproverReviewForm,
} from '@/features/application/approver-review'
import { DecisionFields, useDecisionForm } from '@/features/application/decide'
import { useTranslation } from '@/shared/i18n'
import { apiUrl, requestJson } from '@/shared/api'
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

function NormcontrolWork({ application, onSelect }: { application: Application; onSelect?: (selection: SheetSelection | null) => void }) {
  const { t } = useTranslation()
  const { aiReview, approverReview } = application
  const linked = useQuery({
    queryKey: ['applications', application.id, 'locations', application.aiReview?.assistant?.completed],
    queryFn: () => requestJson<{ locations: Record<string, FindingLocation[]> }>(apiUrl(`/applications/${application.id}/locations`)),
  })
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
      {aiReview?.assistant?.state === 'failed' && (
        <p className="rounded-lg border p-3 text-sm text-muted-foreground">
          Часть пояснений недоступна. Результаты проверки сохранены.
        </p>
      )}
      {aiReview?.summary && (
        <Section title={t('normcontrol.compare.aiSummary')}>
          <p className="text-sm">{aiReview.summary}</p>
        </Section>
      )}
      {(aiDone || approverReview) && (
        <Section title={t('normcontrol.compare.title')}>
          <ReviewComparison
            ai={aiDone && aiReview ? { ...aiReview, items: aiReview.items.map(item => ({ ...item, locations: linked.data?.locations[item.id] ?? item.locations })) } : null}
            approver={approverReview}
            onSelect={onSelect}
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
      <h1 className="truncate text-lg font-semibold">{application.address}</h1>
      {application.description && (
        <p className="line-clamp-1 text-sm text-muted-foreground">
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
  const [selection, setSelection] = useState<SheetSelection | null>(null)
  const [tab, setTab] = useState<'work' | 'properties' | 'history'>('work')

  if (isPending) return <Skeleton className="h-64" />
  if (isError) {
    return <p className="text-destructive">{t('application.notFound')}</p>
  }

  const properties = <ApplicationProperties application={data} showApplicant />
  const work =
    role === 'approver' ? (
      <ApproverWork key={data.status} application={data} />
    ) : (
      <NormcontrolWork application={data} onSelect={setSelection} />
    )
  const decision = <DecisionBlock application={data} role={role} />
  const history = (
    <Section title={t('application.versions.title')}>
      <VersionHistory application={data} showSummary={role === 'normcontrol'} />
    </Section>
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
      {layout === 'page' && <div className="shrink-0"><ApplicationHeading application={data} /></div>}
      <div className={layout === 'panel'
        ? 'grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_minmax(0,1fr)] gap-3'
        : 'grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_minmax(0,1fr)] gap-3 md:grid-cols-[minmax(0,1fr)_24rem] md:grid-rows-1'}>
        <ApplicationSheetViewer key={data.id} application={data} selection={selection} />
        <aside className="flex min-h-0 min-w-0 flex-col gap-3 rounded-xl border p-3">
          <nav className="flex shrink-0 gap-1 border-b pb-2" aria-label="Разделы проверки">
            {([['work', 'Проверка'], ['properties', 'Заявка'], ['history', 'Версии']] as const).map(([value, label]) => (
              <button key={value} type="button" aria-pressed={tab === value} onClick={() => setTab(value)}
                className={`rounded-md px-3 py-1.5 text-sm ${tab === value ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}>{label}</button>
            ))}
          </nav>
          <div className={tab === 'work' ? 'flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto' : 'hidden'}>{work}{decision}</div>
          {tab === 'properties' && <div className="min-h-0 flex-1 overflow-y-auto">{properties}</div>}
          {tab === 'history' && <div className="min-h-0 flex-1 overflow-y-auto">{history}</div>}
        </aside>
      </div>
    </div>
  )
}
