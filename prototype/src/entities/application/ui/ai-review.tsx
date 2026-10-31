import {
  IconAlertCircle,
  IconCircleCheck,
  IconCircleMinus,
  IconHelpCircle,
  IconListCheck,
  IconSparkles,
} from '@tabler/icons-react'
import { useState } from 'react'

import { useTranslation } from '@/shared/i18n'
import { Badge } from '@/shared/ui/components/badge'
import {
  ToggleGroup,
  ToggleGroupItem,
} from '@/shared/ui/components/toggle-group'
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

import type { AiReview, AiReviewItem, AiVerdict } from '../model'

const VERDICT_ICONS: Record<AiVerdict, typeof IconCircleCheck> = {
  violation: IconAlertCircle,
  ok: IconCircleCheck,
  not_applicable: IconCircleMinus,
  unknown: IconHelpCircle,
}

const VERDICT_COLORS: Record<AiVerdict, string> = {
  violation: 'text-destructive',
  ok: 'text-emerald-500',
  not_applicable: 'text-muted-foreground',
  unknown: 'text-amber-500',
}

const VERDICT_STATUS: Partial<Record<AiVerdict, 'error' | 'pending'>> = {
  violation: 'error',
  not_applicable: 'pending',
}

function VerdictIcon({ verdict }: { verdict: AiVerdict }) {
  const Icon = VERDICT_ICONS[verdict]
  return <Icon className={VERDICT_COLORS[verdict]} />
}

function groupBySection(items: AiReviewItem[]) {
  const groups = new Map<string, AiReviewItem[]>()
  for (const item of items) {
    groups.set(item.section, [...(groups.get(item.section) ?? []), item])
  }
  return [...groups]
}

function countVerdicts(items: AiReviewItem[]) {
  return items.reduce<Record<AiVerdict, number>>(
    (acc, item) => ({ ...acc, [item.verdict]: acc[item.verdict] + 1 }),
    { violation: 0, ok: 0, not_applicable: 0, unknown: 0 },
  )
}

function ChecklistItem({ item }: { item: AiReviewItem }) {
  const { t } = useTranslation()
  return (
    <TraceCollapsible>
      <TraceCollapsibleTrigger>
        <TraceLine status={VERDICT_STATUS[item.verdict]} title={item.title}>
          <TraceIcon>
            <VerdictIcon verdict={item.verdict} />
          </TraceIcon>
          <TraceTitle>{item.title}</TraceTitle>
          <TraceDescription>{item.result}</TraceDescription>
        </TraceLine>
      </TraceCollapsibleTrigger>
      <TraceCollapsibleContent className="flex flex-col gap-1 text-sm">
        <span className="text-foreground">{item.title}</span>
        <span>
          {t(`application.aiReview.verdict.${item.verdict}`)} · {item.comment}
        </span>
        {item.basis && <span className="text-xs">{item.basis}</span>}
      </TraceCollapsibleContent>
    </TraceCollapsible>
  )
}

export function AiReviewPanel({
  review,
  checking,
}: {
  review: AiReview | null
  checking: boolean
}) {
  const { t } = useTranslation()
  const [filter, setFilter] = useState<'issues' | 'all'>('issues')

  if (checking || review?.state === 'running') {
    return (
      <Trace>
        <TraceLine status="running">
          <TraceIcon>
            <IconSparkles />
          </TraceIcon>
          <TraceTitle>{t('application.aiReview.running')}</TraceTitle>
        </TraceLine>
      </Trace>
    )
  }
  if (!review) {
    return (
      <p className="text-sm text-muted-foreground">
        {t('application.aiReview.empty')}
      </p>
    )
  }
  if (review.state === 'failed') {
    return (
      <Trace>
        <TraceLine status="error">
          <TraceIcon>
            <IconAlertCircle />
          </TraceIcon>
          <TraceTitle>
            {t('application.aiReview.failed', { error: review.error ?? '' })}
          </TraceTitle>
        </TraceLine>
      </Trace>
    )
  }

  const counts = countVerdicts(review.items)
  const visible =
    filter === 'all'
      ? review.items
      : review.items.filter(
          item => item.verdict === 'violation' || item.verdict === 'unknown',
        )

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        {review.model === 'demo' && (
          <Badge variant="outline">{t('application.aiReview.demo')}</Badge>
        )}
        {(Object.keys(counts) as AiVerdict[]).map(verdict => (
          <span
            key={verdict}
            className="inline-flex items-center gap-1 text-muted-foreground [&_svg]:size-4"
          >
            <VerdictIcon verdict={verdict} />
            {t(`application.aiReview.verdict.${verdict}`)}
            <span className="text-foreground tabular-nums">
              {counts[verdict]}
            </span>
          </span>
        ))}
      </div>
      <p className="text-sm">{review.summary}</p>
      <ToggleGroup
        value={[filter]}
        onValueChange={value => {
          const next = value[0]
          if (next === 'all' || next === 'issues') setFilter(next)
        }}
        variant="outline"
        size="sm"
      >
        <ToggleGroupItem value="issues">
          {t('application.aiReview.filterIssues')}
        </ToggleGroupItem>
        <ToggleGroupItem value="all">
          {t('application.aiReview.filterAll')}
        </ToggleGroupItem>
      </ToggleGroup>
      <Trace>
        {groupBySection(visible).map(([section, items]) => {
          const sectionCounts = countVerdicts(items)
          return (
            <TraceCollapsible
              key={`${filter}-${section}`}
              defaultOpen={filter === 'issues'}
            >
              <TraceCollapsibleTrigger>
                <TraceLine
                  status={sectionCounts.violation ? 'error' : undefined}
                >
                  <TraceIcon>
                    <IconListCheck />
                  </TraceIcon>
                  <TraceTitle>{section}</TraceTitle>
                  <TraceDescription>
                    {t('application.aiReview.sectionCounts', {
                      violations: sectionCounts.violation,
                      total: items.length,
                    })}
                  </TraceDescription>
                </TraceLine>
              </TraceCollapsibleTrigger>
              <TraceCollapsibleContent>
                <Trace>
                  {items.map(item => (
                    <ChecklistItem key={item.id} item={item} />
                  ))}
                </Trace>
              </TraceCollapsibleContent>
            </TraceCollapsible>
          )
        })}
      </Trace>
    </div>
  )
}
