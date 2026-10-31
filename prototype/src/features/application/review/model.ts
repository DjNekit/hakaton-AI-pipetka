import {
  applicationKeys,
  reviewSchema,
  type Application,
  type ReviewData,
} from '@/entities/application'
import { requestJson } from '@/shared/api'
import {
  useMutation,
  useQueryClient,
  type MutationCallbacks,
} from '@/shared/query'
import { blurFirstValidationLogic, useAppForm } from '@/shared/ui/form'

export interface UpdateApplicationVariables {
  id: string
  patch: Partial<ReviewData>
}

export function useUpdateApplication() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: UpdateApplicationVariables) =>
      requestJson<Application>(`/api/applications/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      }),
    onMutate: async ({ id, patch }) => {
      await queryClient.cancelQueries({ queryKey: applicationKeys.all })
      const previous = queryClient.getQueryData<Application[]>(
        applicationKeys.all,
      )
      queryClient.setQueryData<Application[]>(applicationKeys.all, list =>
        list?.map(item => (item.id === id ? { ...item, ...patch } : item)),
      )
      return { previous }
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(applicationKeys.all, context.previous)
      }
    },
    onSuccess: application => {
      queryClient.setQueryData(
        applicationKeys.detail(application.id),
        application,
      )
    },
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: applicationKeys.all }),
  })
}

export function useReviewForm(
  application: Application,
  callbacks?: MutationCallbacks<
    Application,
    Error,
    UpdateApplicationVariables,
    unknown
  >,
) {
  const update = useUpdateApplication()
  return useAppForm({
    defaultValues: {
      status:
        application.status === 'ai_check' ? 'in_review' : application.status,
      reviewComment: application.reviewComment,
    } as ReviewData,
    onSubmit: async ({ value }) => {
      await update
        .mutateAsync({ id: application.id, patch: value }, callbacks)
        .catch(() => undefined)
    },
    validationLogic: blurFirstValidationLogic,
  })
}

export { reviewSchema }
