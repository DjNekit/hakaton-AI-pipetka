import {
  IconAlertCircle,
  IconAlertTriangle,
  IconCircleCheck,
  IconFileSearch,
  IconSparkles,
} from '@tabler/icons-react'

import { useTranslation } from '@/shared/i18n'
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from '@/shared/ui/components/trace'

import {
  checkOutcome,
  useVersionAdvice,
  useVersionCheck,
  type PrecheckFinding,
} from './model'

function FindingLine({ finding }: { finding: PrecheckFinding }) {
  const { t } = useTranslation()
  const isError = finding.severity === 'error'
  return (
    <TraceCollapsible>
      <TraceCollapsibleTrigger>
        <TraceLine status={isError ? 'error' : undefined} title={finding.title}>
          <TraceIcon>
            {isError ? (
              <IconAlertCircle className="text-destructive" />
            ) : (
              <IconAlertTriangle className="text-amber-500" />
            )}
          </TraceIcon>
          <TraceTitle>{finding.message}</TraceTitle>
          {finding.page !== null && (
            <TraceDescription>
              {t('applicant.precheck.page', { page: finding.page })}
            </TraceDescription>
          )}
        </TraceLine>
      </TraceCollapsibleTrigger>
      <TraceCollapsibleContent className="flex flex-col gap-1 text-sm">
        <span className="text-foreground">{finding.title}</span>
        <span>{finding.message}</span>
        {finding.expected && (
          <span>
            {t('applicant.precheck.expected')}: {finding.expected}
          </span>
        )}
        {finding.actual && (
          <span>
            {t('applicant.precheck.actual')}: {finding.actual}
          </span>
        )}
        {finding.ref && <span className="text-xs">{finding.ref}</span>}
      </TraceCollapsibleContent>
    </TraceCollapsible>
  )
}

function Advice({
  applicationId,
  versionId,
}: {
  applicationId: string
  versionId: string
}) {
  const { t } = useTranslation()
  const advice = useVersionAdvice(applicationId, versionId, true)
  if (advice.isPending) {
    return (
      <Trace>
        <TraceLine status="running">
          <TraceIcon>
            <IconSparkles />
          </TraceIcon>
          <TraceTitle>{t('applicant.precheck.adviceLoading')}</TraceTitle>
        </TraceLine>
      </Trace>
    )
  }
  if (advice.isError) {
    return (
      <p className="text-sm text-muted-foreground">
        {t('applicant.precheck.adviceUnavailable')}
      </p>
    )
  }
  return (
    <div className="flex flex-col gap-1 rounded-lg border bg-muted/30 p-3">
      <span className="inline-flex items-center gap-1.5 text-sm font-medium [&_svg]:size-4">
        <IconSparkles />
        {t('applicant.precheck.adviceTitle')}
      </span>
      <p className="text-sm whitespace-pre-wrap">{advice.data.text}</p>
    </div>
  )
}

export function VersionCheckResult({
  applicationId,
  versionId,
  withAdvice = true,
}: {
  applicationId: string
  versionId: string
  withAdvice?: boolean
}) {
  const { t } = useTranslation()
  const check = useVersionCheck(applicationId, versionId)
  const outcome = checkOutcome(check.data)
  const findings = check.data?.result?.findings ?? []
  const errors = findings.filter(f => f.severity === 'error')
  const warnings = findings.filter(f => f.severity === 'warning')

  if (check.isError || outcome === 'failed') {
    return (
      <p className="text-sm text-destructive">
        {t('applicant.precheck.failed')}
      </p>
    )
  }
  if (outcome === 'running') {
    return (
      <Trace>
        <TraceLine status="running">
          <TraceIcon>
            <IconFileSearch />
          </TraceIcon>
          <TraceTitle>
            {check.data?.stage || t('applicant.precheck.queued')}
          </TraceTitle>
          {check.data && (
            <TraceDescription>
              {Math.round(check.data.progress * 100)}%
            </TraceDescription>
          )}
        </TraceLine>
      </Trace>
    )
  }
  if (outcome === 'clean') {
    return (
      <p className="inline-flex items-center gap-1.5 text-sm text-emerald-600 dark:text-emerald-400 [&_svg]:size-4">
        <IconCircleCheck />
        {t('applicant.precheck.clean')}
      </p>
    )
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm">
        {t('applicant.precheck.summary', {
          errors: errors.length,
          warnings: warnings.length,
        })}
      </p>
      {withAdvice && (
        <Advice applicationId={applicationId} versionId={versionId} />
      )}
      <Trace>
        {[...errors, ...warnings].map((finding, index) => (
          <FindingLine key={`${finding.rule}-${index}`} finding={finding} />
        ))}
      </Trace>
    </div>
  )
}
