import { Link } from '@tanstack/react-router'

import {
  APPLICATION_STATUSES,
  ApplicationNumber,
  DocumentTypeLabel,
  formatShortDate,
  StatusIcon,
  type Application,
} from '@/entities/application'
import type { Role } from '@/entities/auth'
import { useTranslation } from '@/shared/i18n'

type StaffRole = Exclude<Role, 'applicant'>

function Progress({
  application,
  role,
}: {
  application: Application
  role: StaffRole
}) {
  const { t } = useTranslation()
  if (application.status !== 'review') return null
  if (role === 'approver') {
    const done = Boolean(application.approverReview)
    return (
      <span
        className={`text-xs ${done ? 'text-muted-foreground' : 'font-medium text-amber-600 dark:text-amber-400'}`}
      >
        {t('application.progress.mine')}:{' '}
        {t(`application.progress.${done ? 'mineDone' : 'mineTodo'}`)}
      </span>
    )
  }
  const aiState = application.aiReview?.state
  const aiDone = aiState === 'done' || aiState === 'failed'
  return (
    <span className="text-xs text-muted-foreground">
      {t('application.progress.ai')}:{' '}
      {t(`application.progress.${aiDone ? 'done' : 'pending'}`)} ·{' '}
      {t('application.progress.approver')}:{' '}
      {t(
        `application.progress.${application.approverReview ? 'done' : 'pending'}`,
      )}
    </span>
  )
}

export function ApplicationsBoard({
  applications,
  role,
  selectedId,
}: {
  applications: Application[]
  role: StaffRole
  selectedId?: string
}) {
  const { t } = useTranslation()
  const basePath = role === 'normcontrol' ? '/normcontrol' : '/approver'

  return (
    <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto px-4 py-4 sm:px-6">
      {APPLICATION_STATUSES.map(status => {
        const items = applications.filter(item => item.status === status)
        return (
          <section
            key={status}
            className="flex w-72 shrink-0 flex-col gap-2 rounded-xl bg-muted/40 p-2"
          >
            <header className="flex items-center gap-2 px-1.5 py-1 text-sm font-medium">
              <StatusIcon status={status} />
              {t(`application.status.${status}`)}
              <span className="text-muted-foreground">{items.length}</span>
            </header>
            {items.length === 0 && (
              <p className="px-1.5 py-6 text-center text-xs text-muted-foreground">
                {t('approver.board.emptyColumn')}
              </p>
            )}
            {items.map(item => (
              <Link
                key={item.id}
                to={basePath}
                search={prev => ({ ...prev, selected: item.id })}
                className={`flex flex-col gap-1.5 rounded-lg border bg-card p-3 text-sm shadow-xs transition hover:border-foreground/20 ${
                  selectedId === item.id
                    ? 'border-foreground/30 ring-2 ring-ring/20'
                    : ''
                }`}
              >
                <div className="flex items-center justify-between">
                  <ApplicationNumber number={item.number} />
                  <span className="text-xs text-muted-foreground">
                    {formatShortDate(item.createdAt)}
                  </span>
                </div>
                <div className="flex items-start gap-2">
                  <StatusIcon
                    status={item.status}
                    className="mt-0.5 size-3.5"
                  />
                  <span className="line-clamp-2 font-medium">
                    {item.address}
                  </span>
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  <DocumentTypeLabel type={item.documentType} />
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {item.applicantName}
                </div>
                <Progress application={item} role={role} />
              </Link>
            ))}
          </section>
        )
      })}
    </div>
  )
}
