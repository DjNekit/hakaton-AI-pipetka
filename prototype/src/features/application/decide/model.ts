import {
  applicationKeys,
  type Application,
  type DecisionValue,
} from '@/entities/application'
import { apiUrl, requestJson } from '@/shared/api'
import { i18n } from '@/shared/i18n'
import {
  useMutation,
  useQueryClient,
  type MutationCallbacks,
} from '@/shared/query'
import { blurFirstValidationLogic, useAppForm } from '@/shared/ui/form'

interface Payload {
  decision: DecisionValue
  comment: string
}

export function rejectionCommentValidator({
  value,
  fieldApi,
}: {
  value: string
  fieldApi: { form: { getFieldValue: (name: 'decision') => DecisionValue } }
}) {
  return fieldApi.form.getFieldValue('decision') === 'rejected' && !value.trim()
    ? { message: i18n.t('normcontrol.decide.commentRequired') }
    : undefined
}

export function useDecide(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: Payload) =>
      requestJson<Application>(apiUrl(`/applications/${id}/decision`), {
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

export function useDecisionForm(
  application: Application,
  callbacks?: MutationCallbacks<Application, Error, Payload>,
) {
  const decide = useDecide(application.id)
  return useAppForm({
    defaultValues: { decision: 'approved', comment: '' } as Payload,
    validationLogic: blurFirstValidationLogic,
    onSubmit: async ({ value }) => {
      await decide
        .mutateAsync({ ...value, comment: value.comment.trim() }, callbacks)
        .catch(() => undefined)
    },
  })
}
