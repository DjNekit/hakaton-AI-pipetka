import { IconCircleCheck, IconCircleX } from '@tabler/icons-react'

import { useTranslation } from '@/shared/i18n'

import type { ApproverReview, Decision } from '../model'
import { formatDateTime } from './labels'

export function DecisionCard({ decision }: { decision: Decision | null }) {
  const { t } = useTranslation()
  if (!decision) {
    return (
      <p className="text-sm text-muted-foreground">
        {t('application.decision.pending')}
      </p>
    )
  }
  const approved = decision.decision === 'approved'
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border p-4">
      <span
        className={`inline-flex items-center gap-1.5 text-sm font-medium [&_svg]:size-4 ${approved ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive'}`}
      >
        {approved ? <IconCircleCheck /> : <IconCircleX />}
        {t(`application.decision.${decision.decision}`)}
      </span>
      {decision.comment && (
        <p className="text-sm whitespace-pre-wrap">{decision.comment}</p>
      )}
      <span className="text-xs text-muted-foreground">
        {t('application.decision.by', {
          name: decision.deciderName,
          date: formatDateTime(decision.decidedAt),
        })}
      </span>
    </div>
  )
}

export function ApproverConclusion({ review }: { review: ApproverReview }) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border p-4">
      <span className="text-sm font-medium">
        {t(`application.recommendation.${review.recommendation}`)}
      </span>
      {review.comment && (
        <p className="text-sm whitespace-pre-wrap">{review.comment}</p>
      )}
      <span className="text-xs text-muted-foreground">
        {t('application.decision.by', {
          name: review.reviewerName,
          date: formatDateTime(review.submittedAt),
        })}
      </span>
    </div>
  )
}
