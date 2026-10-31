import { DOCUMENT_TYPES } from '@/entities/application'
import { useTranslation } from '@/shared/i18n'
import { FieldDescription } from '@/shared/ui/components/field'

import { draftSchema, fileValidator, useDraftForm } from './model'

type Form = ReturnType<typeof useDraftForm>

export function DraftFields({
  form,
  fileKey,
}: {
  form: Form
  fileKey: string
}) {
  const { t } = useTranslation()
  const options = DOCUMENT_TYPES.map(value => ({
    value,
    label: t(`application.documentType.${value}`),
  }))

  return (
    <>
      <form.AppField
        name="documentType"
        validators={{ onDynamic: draftSchema.shape.documentType }}
        children={field => (
          <field.Root>
            <field.Label>{t('application.fields.documentType')}</field.Label>
            <field.Select options={options} className="w-full" />
            <field.Error />
          </field.Root>
        )}
      />
      <form.AppField
        name="address"
        validators={{ onDynamic: draftSchema.shape.address }}
        children={field => (
          <field.Root>
            <field.Label>{t('application.fields.address')}</field.Label>
            <field.Input
              placeholder={t('applicant.submit.addressPlaceholder')}
            />
            <field.Error />
          </field.Root>
        )}
      />
      <form.AppField
        name="description"
        validators={{ onDynamic: draftSchema.shape.description }}
        children={field => (
          <field.Root>
            <field.Label>{t('application.fields.description')}</field.Label>
            <field.Textarea
              placeholder={t('applicant.submit.descriptionPlaceholder')}
            />
            <field.Error />
          </field.Root>
        )}
      />
      <form.AppField
        key={fileKey}
        name="files"
        validators={{ onDynamic: fileValidator }}
        children={field => (
          <field.Root>
            <field.Label>Пакет документов</field.Label>
            <input type="file" accept="application/pdf,.pdf" multiple
              aria-label="Пакет документов PDF"
              onBlur={field.handleBlur}
              onChange={event => {
                const selected = Array.from(event.target.files ?? [])
                if (!selected.length) return
                const existing = field.state.value
                const added = selected.filter(file => !existing.some(current =>
                  current.name === file.name && current.size === file.size &&
                  current.lastModified === file.lastModified))
                field.handleChange([...existing, ...added])
                field.handleBlur()
                event.target.value = ''
              }} />
            {field.state.value.length > 0 && (
              <div className="space-y-2" aria-live="polite">
                <p className="text-sm">Файлов в пакете: {field.state.value.length} из 20</p>
                <ul className="space-y-1">
                  {field.state.value.map((file, index) => (
                    <li key={`${file.name}-${file.size}-${file.lastModified}`}
                      className="flex items-center justify-between gap-3 text-sm">
                      <span className="min-w-0 break-all">{file.name}</span>
                      <button type="button" className="shrink-0 underline underline-offset-4"
                        aria-label={`Удалить ${file.name}`}
                        onClick={() => {
                          field.handleChange(field.state.value.filter((_, i) => i !== index))
                          field.handleBlur()
                        }}>Удалить</button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <FieldDescription>
              До 20 PDF, каждый до 50 МБ. Можно выбрать несколько сразу или добавлять по одному.
            </FieldDescription>
            <field.Error />
          </field.Root>
        )}
      />
    </>
  )
}
