import {
  applicationKeys,
  documentTypeSchema,
  type Application,
  type DocumentType,
} from '@/entities/application'
import { HttpError, apiUrl, requestJson } from '@/shared/api'
import { i18n, z } from '@/shared/i18n'
import {
  useMutation,
  useQueryClient,
  type MutationCallbacks,
} from '@/shared/query'
import { blurFirstValidationLogic, useAppForm } from '@/shared/ui/form'

const MAX_FILE_SIZE = 50 * 1024 * 1024

export const submitApplicationSchema = z.object({
  documentType: documentTypeSchema,
  address: z.string().trim().nonempty().max(300),
  description: z.string().max(2000),
  files: z.array(z
    .instanceof(File, { message: i18n.t('validation.fileRequired') })
    .refine(file => file.type === 'application/pdf', {
      message: i18n.t('validation.pdfOnly'),
    })
    .refine(file => file.size <= MAX_FILE_SIZE, {
      message: i18n.t('validation.fileTooLarge'),
    })).min(1, { message: i18n.t('validation.fileRequired') }).max(20),
})

export interface SubmitApplicationData {
  documentType: DocumentType
  address: string
  description: string
  files: File[]
}

export type SubmitApplicationCallbacks = MutationCallbacks<
  Application,
  Error,
  SubmitApplicationData
>

export function useSubmitApplication() {
  const queryClient = useQueryClient()
  return useMutation<Application, Error, SubmitApplicationData>({
    mutationFn: value => {
      const body = new FormData()
      body.set('documentType', value.documentType)
      body.set('address', value.address)
      body.set('description', value.description)
      for (const file of value.files) body.append('files', file)
      return requestJson<Application>(apiUrl('/applications'), {
        method: 'POST',
        body,
      })
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: applicationKeys.all }),
    meta: {
      errorMessage: error =>
        error instanceof HttpError
          ? i18n.t(`applicant.submit.errors.${error.message}`, {
              defaultValue: error.message,
            })
          : undefined,
    },
  })
}

export function useSubmitApplicationForm(
  callbacks?: SubmitApplicationCallbacks,
) {
  const submit = useSubmitApplication()
  return useAppForm({
    defaultValues: {
      documentType: 'passport',
      address: '',
      description: '',
      files: [],
    } as SubmitApplicationData,
    onSubmit: async ({ value }) => {
      await submit.mutateAsync(value, callbacks).catch(() => undefined)
    },
    validationLogic: blurFirstValidationLogic,
  })
}
