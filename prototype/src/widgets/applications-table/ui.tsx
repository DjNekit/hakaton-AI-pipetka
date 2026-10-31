import { Link } from '@tanstack/react-router'

import {
  APPLICATION_STATUSES,
  ApplicationNumber,
  DocumentTypeLabel,
  formatShortDate,
  StatusIcon,
  type Application,
} from '@/entities/application'
import { useTranslation } from '@/shared/i18n'

export type ApplicationDetailRoute = '/approver/$id' | '/applicant/$id'

export function ApplicationsTable({
  applications,
  detailRoute,
  showApplicant,
}: {
  applications: Application[]
  detailRoute: ApplicationDetailRoute
  showApplicant?: boolean
}) {
  const { t } = useTranslation()
  const groups = APPLICATION_STATUSES.map(status => ({
    status,
    items: applications.filter(item => item.status === status),
  })).filter(group => group.items.length > 0)

  return (
    <div className="flex flex-col">
      {groups.map(group => (
        <section key={group.status}>
          <header className="flex items-center gap-2 border-y bg-muted/40 px-4 py-2 text-sm font-medium sm:px-6">
            <StatusIcon status={group.status} />
            {t(`application.status.${group.status}`)}
            <span className="text-muted-foreground">{group.items.length}</span>
          </header>
          <ul>
            {group.items.map(item => (
              <li key={item.id}>
                <Link
                  to={detailRoute}
                  params={{ id: item.id }}
                  className="flex h-11 items-center gap-3 border-b px-4 text-sm hover:bg-muted/50 sm:px-6"
                >
                  <span className="w-14 shrink-0">
                    <ApplicationNumber number={item.number} />
                  </span>
                  <StatusIcon status={item.status} />
                  <span className="min-w-0 flex-1 truncate">
                    {item.address}
                  </span>
                  <span className="hidden shrink-0 truncate text-muted-foreground md:block md:w-72">
                    <DocumentTypeLabel type={item.documentType} />
                  </span>
                  {showApplicant && (
                    <span className="hidden w-40 shrink-0 truncate text-muted-foreground lg:block">
                      {item.applicantName}
                    </span>
                  )}
                  <span className="w-16 shrink-0 text-right text-xs text-muted-foreground">
                    {formatShortDate(item.createdAt)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
