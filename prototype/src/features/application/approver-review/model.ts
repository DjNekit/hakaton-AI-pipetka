import {
  applicationKeys,
  type Application,
  type ChecklistItem,
  type Recommendation,
  type Verdict,
} from '@/entities/application'
import { apiUrl, requestJson } from '@/shared/api'
import { i18n } from '@/shared/i18n'
import {
  useMutation,
  useQueryClient,
  type MutationCallbacks,
} from '@/shared/query'
import { blurFirstValidationLogic, useAppForm } from '@/shared/ui/form'

function required(message: () => string) {
  return ({ value }: { value: string }) =>
    value ? undefined : { message: message() }
}

export const verdictFieldValidator = required(() =>
  i18n.t('approver.review.chooseVerdict'),
)
export const recommendationFieldValidator = required(() =>
  i18n.t('approver.review.chooseRecommendation'),
)

export interface ApproverReviewValues {
  items: Array<{ id: string; verdict: Verdict | ''; comment: string }>
  recommendation: Recommendation | ''
  comment: string
}

interface Payload {
  items: Array<{ id: string; verdict: Verdict; comment: string }>
  recommendation: Recommendation
  comment: string
}

export function useSubmitApproverReview(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: Payload) =>
      requestJson<Application>(apiUrl(`/applications/${id}/approver-review`), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      }),
    onSuccess: application => {
      queryClient.setQueryData(applicationKeys.detail(id), application)
      void queryClient.invalidateQueries({ queryKey: applicationKeys.all })
    },
  })
}

export function useApproverReviewForm(
  application: Application,
  checklist: ChecklistItem[],
  callbacks?: MutationCallbacks<Application, Error, Payload>,
) {
  const submit = useSubmitApproverReview(application.id)
  return useAppForm({
    defaultValues: {
      items: checklist.map(item => ({ id: item.id, verdict: '', comment: '' })),
      recommendation: '',
      comment: '',
    } as ApproverReviewValues,
    validationLogic: blurFirstValidationLogic,
    onSubmit: async ({ value }) => {
      await submit
        .mutateAsync(
          {
            items: value.items.map(item => ({
              id: item.id,
              verdict: item.verdict as Verdict,
              comment: item.comment.trim(),
            })),
            recommendation: value.recommendation as Recommendation,
            comment: value.comment.trim(),
          },
          callbacks,
        )
        .catch(() => undefined)
    },
  })
}
