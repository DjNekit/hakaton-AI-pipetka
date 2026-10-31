import type { ReactNode } from 'react'

import { useTranslation } from '@/shared/i18n'

import { applicationFileUrl, type Application } from '../model'
import { DocumentTypeLabel, formatDateTime, StatusLabel } from './labels'

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3 py-1.5 text-sm sm:grid-cols-[9rem_minmax(0,1fr)]">
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </div>
  )
}

export function ApplicationProperties({
  application,
  showApplicant,
}: {
  application: Application
  showApplicant?: boolean
}) {
  const { t } = useTranslation()
  return (
    <dl className="flex flex-col">
      <Row label={t('application.fields.status')}>
        <StatusLabel status={application.status} />
      </Row>
      <Row label={t('application.fields.documentType')}>
        <DocumentTypeLabel type={application.documentType} />
      </Row>
      {showApplicant && (
        <Row label={t('application.fields.applicant')}>
          {application.applicantName} · {application.applicantEmail}
        </Row>
      )}
      <Row label={t('application.fields.createdAt')}>
        {formatDateTime(application.createdAt)}
      </Row>
      <Row label={t('application.fields.updatedAt')}>
        {formatDateTime(application.updatedAt)}
      </Row>
      <Row label={t('application.fields.file')}>
        <a
          href={applicationFileUrl(application.id)}
          target="_blank"
          rel="noreferrer"
          className="underline underline-offset-4"
        >
          {application.fileName}
        </a>
      </Row>
    </dl>
  )
}
