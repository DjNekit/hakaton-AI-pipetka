import {
  applicationKeys,
  type Application,
} from '@/entities/application'
import { HttpError, apiUrl, requestJson } from '@/shared/api'
import { i18n, z } from '@/shared/i18n'
import { useMutation, useQueryClient } from '@/shared/query'
import { blurFirstValidationLogic, useAppForm } from '@/shared/ui/form'

const MAX_FILE_SIZE = 50 * 1024 * 1024

export const draftSchema = z.object({
  description: z.string().max(2000),
})

export function fileValidator({ value }: { value: File[] }) {
  if (value.length > 20) return { message: 'Не более 20 файлов' }
  for (const file of value) {
    if (file.type !== 'application/pdf') return { message: i18n.t('validation.pdfOnly') }
    if (file.size > MAX_FILE_SIZE) return { message: i18n.t('validation.fileTooLarge') }
  }
  return undefined
}

export interface DraftValues {
  description: string
  files: File[]
}

const errorMeta = {
  errorMessage: (error: unknown) =>
    error instanceof HttpError
      ? i18n.t(`applicant.submit.errors.${error.message}`, {
          defaultValue: error.message,
        })
      : undefined,
}

function uploadBody(values: DraftValues, files: File[]) {
  const body = new FormData()
  body.set('description', values.description.trim())
  for (const file of files) body.append('files', file)
  return body
}

function useCacheApplication() {
  const queryClient = useQueryClient()
  return (application: Application) => {
    queryClient.setQueryData(
      applicationKeys.detail(application.id),
      application,
    )
    void queryClient.invalidateQueries({ queryKey: applicationKeys.all })
  }
}

export function useCheckVersion(applicationId: string | undefined) {
  const cache = useCacheApplication()
  return useMutation({
    mutationFn: ({ values, files }: { values: DraftValues; files: File[] }) =>
      requestJson<Application>(
        apiUrl(
          applicationId
            ? `/applications/${applicationId}/versions`
            : '/applications/drafts',
        ),
        { method: 'POST', body: uploadBody(values, files) },
      ),
    onSuccess: cache,
    meta: errorMeta,
  })
}

export function useSubmitDraft(applicationId: string) {
  const cache = useCacheApplication()
  return useMutation({
    mutationFn: ({
      values,
      versionId,
    }: {
      values: DraftValues
      versionId: string
    }) =>
      requestJson<Application>(
        apiUrl(`/applications/${applicationId}/submit`),
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            versionId,
            description: values.description.trim(),
          }),
        },
      ),
    onSuccess: cache,
    meta: errorMeta,
  })
}

export function useDraftForm(
  application: Application | undefined,
  onSubmit: (values: DraftValues) => Promise<void>,
) {
  return useAppForm({
    defaultValues: {
      description: application?.description ?? '',
      files: [],
    } as DraftValues,
    onSubmit: ({ value }) => onSubmit(value),
    validationLogic: blurFirstValidationLogic,
  })
}
