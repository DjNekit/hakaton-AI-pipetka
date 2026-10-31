import {
  applicationKeys,
  documentTypeSchema,
  type Application,
  type DocumentType,
} from '@/entities/application'
import { HttpError, apiUrl, requestJson } from '@/shared/api'
import { i18n, z } from '@/shared/i18n'
import { useMutation, useQueryClient } from '@/shared/query'
import { blurFirstValidationLogic, useAppForm } from '@/shared/ui/form'

const MAX_FILE_SIZE = 50 * 1024 * 1024

export const draftSchema = z.object({
  documentType: documentTypeSchema,
  address: z.string().trim().nonempty().max(300),
  description: z.string().max(2000),
})

export function fileValidator({ value }: { value: File | null }) {
  if (!value) return undefined
  if (value.type !== 'application/pdf') {
    return { message: i18n.t('validation.pdfOnly') }
  }
  if (value.size > MAX_FILE_SIZE) {
    return { message: i18n.t('validation.fileTooLarge') }
  }
  return undefined
}

export interface DraftValues {
  documentType: DocumentType
  address: string
  description: string
  file: File | null
}

const errorMeta = {
  errorMessage: (error: unknown) =>
    error instanceof HttpError
      ? i18n.t(`applicant.submit.errors.${error.message}`, {
          defaultValue: error.message,
        })
      : undefined,
}

function uploadBody(values: DraftValues, file: File) {
  const body = new FormData()
  body.set('documentType', values.documentType)
  body.set('address', values.address.trim())
  body.set('description', values.description.trim())
  body.set('file', file)
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
    mutationFn: ({ values, file }: { values: DraftValues; file: File }) =>
      requestJson<Application>(
        apiUrl(
          applicationId
            ? `/applications/${applicationId}/versions`
            : '/applications/drafts',
        ),
        { method: 'POST', body: uploadBody(values, file) },
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
            documentType: values.documentType,
            address: values.address.trim(),
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
      documentType: application?.documentType ?? 'passport',
      address: application?.address ?? '',
      description: application?.description ?? '',
      file: null,
    } as DraftValues,
    onSubmit: ({ value }) => onSubmit(value),
    validationLogic: blurFirstValidationLogic,
  })
}
