import { useTranslation } from '@/shared/i18n'

import {
  formatApplicationNumber,
  type ApplicationStatus,
  type DocumentType,
} from '../model'
import { StatusIcon } from './status-icon'

export function ApplicationNumber({ number }: { number: number }) {
  return (
    <span className="font-mono text-xs text-muted-foreground tabular-nums">
      {formatApplicationNumber(number)}
    </span>
  )
}

export function StatusLabel({ status }: { status: ApplicationStatus }) {
  const { t } = useTranslation()
  return (
    <span className="inline-flex items-center gap-1.5">
      <StatusIcon status={status} />
      {t(`application.status.${status}`)}
    </span>
  )
}

export function DocumentTypeLabel({ type }: { type: DocumentType }) {
  const { t } = useTranslation()
  return <>{t(`application.documentType.${type}`)}</>
}

const dateFormat = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'short',
})
const dateTimeFormat = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

export function formatShortDate(value: string) {
  return dateFormat.format(new Date(value))
}

export function formatDateTime(value: string) {
  return dateTimeFormat.format(new Date(value))
}
