import { IconFileTypePdf } from '@tabler/icons-react'
import type { ReactNode } from 'react'

import { useTranslation } from '@/shared/i18n'
import { Badge } from '@/shared/ui/components/badge'

import {
  versionFileUrl,
  type Application,
  type ApplicationVersion,
} from '../model'
import { formatDateTime } from './labels'

export function VersionSummaryLabel({
  version,
}: {
  version: ApplicationVersion
}) {
  const { t } = useTranslation()
  if (!version.checked) return <>{t('application.versions.notChecked')}</>
  if (!version.summary) return <>{t('application.versions.checking')}</>
  if (version.summary.errors + version.summary.warnings === 0) {
    return (
      <span className="text-emerald-600 dark:text-emerald-400">
        {t('application.versions.clean')}
      </span>
    )
  }
  return (
    <span className={version.summary.errors ? 'text-destructive' : undefined}>
      {t('application.versions.issues', {
        errors: version.summary.errors,
        warnings: version.summary.warnings,
      })}
    </span>
  )
}

export function VersionHistory({
  application,
  showSummary,
  renderDetails,
}: {
  application: Application
  showSummary?: boolean
  renderDetails?: (version: ApplicationVersion) => ReactNode
}) {
  const { t } = useTranslation()
  return (
    <ul className="divide-y rounded-lg border">
      {application.versions.map(version => (
        <li key={version.id} className="flex flex-col gap-2 px-3 py-2.5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <span className="font-medium">
              {t('application.versions.version', { version: version.version })}
            </span>
            {application.submittedVersionId === version.id && (
              <Badge variant="secondary">
                {t('application.versions.submitted')}
              </Badge>
            )}
            <a
              href={versionFileUrl(application.id, version.id)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-w-0 items-center gap-1 text-muted-foreground underline-offset-4 hover:text-foreground hover:underline [&_svg]:size-4 [&_svg]:shrink-0"
            >
              <IconFileTypePdf />
              <span className="truncate">{version.fileName}</span>
            </a>
            <span className="ml-auto text-xs text-muted-foreground">
              {formatDateTime(version.createdAt)}
            </span>
          </div>
          {showSummary && (
            <span className="text-xs text-muted-foreground">
              <VersionSummaryLabel version={version} />
            </span>
          )}
          {renderDetails?.(version)}
        </li>
      ))}
    </ul>
  )
}
