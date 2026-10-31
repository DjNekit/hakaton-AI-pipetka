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
        name="file"
        validators={{ onDynamic: fileValidator }}
        children={field => (
          <field.Root>
            <field.Label>{t('application.fields.file')}</field.Label>
            <field.File accept="application/pdf" />
            <FieldDescription>
              {t('applicant.submit.fileHint')}
            </FieldDescription>
            <field.Error />
          </field.Root>
        )}
      />
    </>
  )
}
