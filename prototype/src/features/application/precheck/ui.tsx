import { useEffect, useState } from 'react'
import { IconAlertCircle, IconAlertTriangle, IconCircleCheck, IconCircleMinus, IconFileSearch } from '@tabler/icons-react'

import type { ChecklistAssistantReview, SheetSelection } from '@/entities/application'
import { useTranslation } from '@/shared/i18n'
import { useQueryClient } from '@/shared/query'
import {
  Trace, TraceCollapsible, TraceCollapsibleContent, TraceCollapsibleTrigger,
  TraceDescription, TraceIcon, TraceLine, TraceTitle,
} from '@/shared/ui/components/trace'

import { checkOutcome, useChecklistAssistant, useVersionCheck, type PrecheckFinding } from './model'

type Select = (selection: SheetSelection | null) => void

function ChecklistRow({ finding, explanation, onSelect }: {
  finding: PrecheckFinding
  explanation?: ChecklistAssistantReview['items'][number]
  onSelect?: Select
}) {
  const good = finding.status === 'ok'
  const skipped = finding.status === 'skip'
  const error = !good && !skipped && finding.severity === 'error'
  const locations = finding.locations ?? []
  const open = (index = 0) => {
    const location = locations[index]
    onSelect?.(location ? { ...location, rule: finding.rule, message: finding.title, severity: finding.severity } : null)
  }
  return (
    <TraceCollapsible>
      <TraceCollapsibleTrigger onClick={() => open()}>
        <TraceLine status={error ? 'error' : undefined} title={finding.title}>
          <TraceIcon>{good ? <IconCircleCheck className="text-emerald-500" /> : skipped ? <IconCircleMinus className="text-muted-foreground" /> : error ? <IconAlertCircle className="text-destructive" /> : <IconAlertTriangle className="text-amber-500" />}</TraceIcon>
          <TraceTitle className="whitespace-normal">{finding.title}</TraceTitle>
          <TraceDescription>{good ? 'Выполнено' : skipped ? 'Не применяется' : error ? 'Ошибка' : 'Требует проверки'}</TraceDescription>
        </TraceLine>
      </TraceCollapsibleTrigger>
      <TraceCollapsibleContent className="flex flex-col gap-2 text-sm">
        <p>{explanation?.explanation || finding.message}</p>
        {explanation?.suggestion && <p><span className="font-medium">Что проверить: </span>{explanation.suggestion}</p>}
        {finding.expected && <p>Ожидается: {finding.expected}</p>}
        {finding.actual && <p>В документе: {finding.actual}</p>}
        {finding.ref && <p className="text-xs text-muted-foreground">{finding.ref}</p>}
        {locations.length ? <div className="flex flex-col gap-2">
          {locations.map((location, index) => <div key={`${location.documentId}-${location.page}-${index}`}>
            <button type="button" onClick={() => open(index)} className="text-left text-xs underline underline-offset-4">
              {location.file} · Лист {location.page}{location.bbox ? ' · Показать место' : ''}
            </button>
            {location.quote && <blockquote className="mt-1 border-l-2 pl-2 text-xs text-muted-foreground">«{location.quote}»</blockquote>}
          </div>)}
        </div> : !good && !skipped && <p className="text-xs text-muted-foreground">Для этого пункта конкретное место на листе не определено.</p>}
      </TraceCollapsibleContent>
    </TraceCollapsible>
  )
}

function Checklist({ applicationId, versionId, findings, withAdvice, onSelect }: {
  applicationId: string; versionId: string; findings: PrecheckFinding[]; withAdvice: boolean; onSelect?: Select
}) {
  // Разбор подключается отдельно, чтобы история без пояснений не запускала модель.
  return withAdvice ? <ExplainedChecklist applicationId={applicationId} versionId={versionId} findings={findings} onSelect={onSelect} />
    : <Trace>{findings.map((finding, index) => <ChecklistRow key={`${finding.rule}-${index}`} finding={finding} onSelect={onSelect} />)}</Trace>
}

function ExplainedChecklist({ applicationId, versionId, findings, onSelect }: {
  applicationId: string; versionId: string; findings: PrecheckFinding[]; onSelect?: Select
}) {
  const assistant = useChecklistAssistant(applicationId, versionId)
  const queryClient = useQueryClient()
  const review = assistant.data?.review
  const [retrying, setRetrying] = useState(false)
  // Новые цитаты добавляют точные координаты в обычный результат проверки.
  useEffect(() => {
    if (review?.completed) void queryClient.invalidateQueries({ queryKey: ['applications', applicationId, 'versions', versionId, 'check'], exact: true })
  }, [review?.completed, applicationId, versionId, queryClient])
  return (
    <div className="flex flex-col gap-3">
      {assistant.isPending || review?.state === 'queued' || review?.state === 'running' ? <p role="status" className="text-xs text-muted-foreground">Уточняем пояснения: {review?.completed ?? 0} из {review?.total ?? '…'}</p> : null}
      {assistant.isError || review?.state === 'failed' ? <p className="text-xs text-muted-foreground">
        Часть пояснений недоступна. Результаты проверки сохранены.{' '}
        <button type="button" disabled={retrying} className="underline disabled:opacity-50" onClick={() => {
          setRetrying(true); void assistant.retry().catch(() => undefined).finally(() => setRetrying(false))
        }}>Повторить</button>
      </p> : null}
      <Trace>{findings.map((finding, index) => <ChecklistRow key={`${finding.rule}-${index}`} finding={finding}
        explanation={review?.items.find(item => item.id === finding.rule)} onSelect={onSelect} />)}</Trace>
    </div>
  )
}

export function VersionCheckResult({ applicationId, versionId, withAdvice = true, onSelect }: {
  applicationId: string; versionId: string; withAdvice?: boolean; onSelect?: Select
}) {
  const { t } = useTranslation()
  const check = useVersionCheck(applicationId, versionId)
  const outcome = checkOutcome(check.data)
  const findings = check.data?.result?.findings ?? []
  if (check.isError || outcome === 'failed') return <p className="text-sm text-destructive">{t('applicant.precheck.failed')}</p>
  if (outcome === 'running') return <Trace><TraceLine status="running"><TraceIcon><IconFileSearch /></TraceIcon>
    <TraceTitle>{check.data?.stage || t('applicant.precheck.queued')}</TraceTitle>
    {check.data && <TraceDescription>{Math.round(check.data.progress * 100)}%</TraceDescription>}
  </TraceLine></Trace>
  const checklist = check.data?.result?.checklist ?? findings
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm">{outcome === 'clean' ? t('applicant.precheck.clean') : t('applicant.precheck.summary', {
        errors: findings.filter(f => f.severity === 'error').length, warnings: findings.filter(f => f.severity === 'warning').length,
      })}</p>
      <Checklist applicationId={applicationId} versionId={versionId} findings={checklist} withAdvice={withAdvice} onSelect={onSelect} />
    </div>
  )
}
