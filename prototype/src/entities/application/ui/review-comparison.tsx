import { useState } from 'react'

import { useTranslation } from '@/shared/i18n'
import {
  ToggleGroup,
  ToggleGroupItem,
} from '@/shared/ui/components/toggle-group'

import type { AiReview, ApproverReview, Verdict, FindingLocation, SheetSelection } from '../model'
import { VerdictIcon } from './ai-review'

interface Row {
  locations?: FindingLocation[]
  id: string
  section: string
  title: string
  basis: string
  ai?: { verdict: Verdict; comment: string }
  approver?: { verdict: Verdict; comment: string }
}

function buildRows(ai: AiReview | null, approver: ApproverReview | null) {
  const rows = new Map<string, Row>()
  for (const item of approver?.items ?? []) {
    rows.set(item.id, {
      ...item,
      approver: { verdict: item.verdict, comment: item.comment },
    })
  }
  for (const item of ai?.items ?? []) {
    const row = rows.get(item.id) ?? { ...item }
    rows.set(item.id, {
      ...row,
      locations: item.locations,
      ai: {
        verdict: item.verdict,
        comment: [item.result, item.comment].filter(Boolean).join(' · '),
      },
    })
  }
  return [...rows.values()]
}

function isMismatch(row: Row) {
  return Boolean(
    row.ai && row.approver && row.ai.verdict !== row.approver.verdict,
  )
}

function needsAttention(row: Row) {
  return (
    isMismatch(row) ||
    row.ai?.verdict === 'violation' ||
    row.approver?.verdict === 'violation'
  )
}

function Opinion({
  label,
  opinion,
}: {
  label: string
  opinion?: { verdict: Verdict; comment: string }
}) {
  const { t } = useTranslation()
  if (!opinion) return null
  return (
    <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="flex flex-col gap-0.5">
        <span className="inline-flex items-center gap-1.5 [&_svg]:size-4">
          <VerdictIcon verdict={opinion.verdict} />
          {t(`application.verdict.${opinion.verdict}`)}
        </span>
        {opinion.comment && (
          <span className="text-xs text-muted-foreground">
            {opinion.comment.replace(/Пояснение GigaChat \(черновик\):/g, 'Пояснение:')}
          </span>
        )}
      </span>
    </div>
  )
}

export function ReviewComparison({
  ai,
  approver,
  onSelect,
}: {
  ai: AiReview | null
  approver: ApproverReview | null
  onSelect?: (selection: SheetSelection | null) => void
}) {
  const { t } = useTranslation()
  const [filter, setFilter] = useState<'diff' | 'all'>('diff')
  const rows = buildRows(ai, approver)
  const visible = filter === 'all' ? rows : rows.filter(needsAttention)
  const sections = [...new Set(visible.map(row => row.section))]

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-sm text-muted-foreground">
          {t('normcontrol.compare.mismatches', {
            count: rows.filter(isMismatch).length,
          })}
        </span>
        <ToggleGroup
          value={[filter]}
          onValueChange={value => {
            const next = value[0]
            if (next === 'diff' || next === 'all') setFilter(next)
          }}
          variant="outline"
          size="sm"
        >
          <ToggleGroupItem value="diff">
            {t('normcontrol.compare.onlyDiff')}
          </ToggleGroupItem>
          <ToggleGroupItem value="all">
            {t('normcontrol.compare.all')}
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
      {visible.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {t('normcontrol.compare.empty')}
        </p>
      )}
      {sections.map(section => (
        <section key={section} className="flex flex-col gap-2">
          <h3 className="text-xs font-medium text-muted-foreground uppercase">
            {section}
          </h3>
          <ul className="divide-y rounded-lg border">
            {visible
              .filter(row => row.section === section)
              .map(row => (
                <li
                  key={row.id}
                  className={`flex flex-col gap-2 px-3 py-2.5 ${isMismatch(row) ? 'bg-amber-500/5' : ''}`}
                >
                  <button type="button" className="text-left text-sm font-medium hover:underline" onClick={() => {
                    const location = row.locations?.[0]
                    onSelect?.(location ? { ...location, rule: row.id, message: row.title, severity: row.ai?.verdict === 'violation' ? 'error' : 'warning' } : null)
                  }}>{row.title}</button>
                  {row.locations?.map((location, index) => <button key={index} type="button" className="text-left text-xs underline" onClick={() => onSelect?.({ ...location, rule: row.id, message: row.title, severity: row.ai?.verdict === 'violation' ? 'error' : 'warning' })}>
                    {location.file} · Лист {location.page}
                  </button>)}
                  <Opinion
                    label={t('normcontrol.compare.ai')}
                    opinion={row.ai}
                  />
                  <Opinion
                    label={t('normcontrol.compare.approver')}
                    opinion={row.approver}
                  />
                  {row.basis && (
                    <span className="text-xs text-muted-foreground">
                      {row.basis}
                    </span>
                  )}
                </li>
              ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
