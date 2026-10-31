import { Link } from '@tanstack/react-router'
import { useState, type DragEvent } from 'react'

import {
  APPLICATION_STATUSES,
  ApplicationNumber,
  DocumentTypeLabel,
  formatShortDate,
  isReviewStatus,
  StatusIcon,
  type Application,
  type ApplicationStatus,
} from '@/entities/application'
import { useUpdateApplication } from '@/features/application/review'
import { useTranslation } from '@/shared/i18n'

const LOCKED: ApplicationStatus = 'ai_check'

function canDrop(from: ApplicationStatus | undefined, to: ApplicationStatus) {
  return from !== undefined && from !== LOCKED && to !== LOCKED && from !== to
}

export function ApplicationsBoard({
  applications,
  selectedId,
}: {
  applications: Application[]
  selectedId?: string
}) {
  const { t } = useTranslation()
  const update = useUpdateApplication()
  const [dragged, setDragged] = useState<Application | null>(null)
  const [over, setOver] = useState<ApplicationStatus | null>(null)

  const onDrop = (status: ApplicationStatus) => (event: DragEvent) => {
    event.preventDefault()
    setOver(null)
    if (dragged && canDrop(dragged.status, status) && isReviewStatus(status)) {
      update.mutate({ id: dragged.id, patch: { status } })
    }
    setDragged(null)
  }

  return (
    <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto px-6 py-4">
      {APPLICATION_STATUSES.map(status => {
        const items = applications.filter(item => item.status === status)
        const droppable = canDrop(dragged?.status, status)
        return (
          <section
            key={status}
            onDragOver={event => {
              if (!droppable) return
              event.preventDefault()
              setOver(status)
            }}
            onDragLeave={() =>
              setOver(current => (current === status ? null : current))
            }
            onDrop={onDrop(status)}
            className={`flex w-72 shrink-0 flex-col gap-2 rounded-xl p-2 transition-colors ${
              over === status ? 'bg-muted' : 'bg-muted/40'
            }`}
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
                to="/approver"
                search={prev => ({ ...prev, selected: item.id })}
                draggable={item.status !== LOCKED}
                onDragStart={() => setDragged(item)}
                onDragEnd={() => {
                  setDragged(null)
                  setOver(null)
                }}
                className={`flex flex-col gap-1.5 rounded-lg border bg-card p-3 text-sm shadow-xs transition hover:border-foreground/20 ${
                  selectedId === item.id
                    ? 'border-foreground/30 ring-2 ring-ring/20'
                    : ''
                } ${
                  dragged?.id === item.id ? 'opacity-50' : ''
                } ${item.status === LOCKED ? 'cursor-default' : 'cursor-grab'}`}
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
              </Link>
            ))}
          </section>
        )
      })}
    </div>
  )
}
