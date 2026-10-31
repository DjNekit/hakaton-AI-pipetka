import { DOCUMENT_TYPES } from '@/entities/application'
import { useTranslation } from '@/shared/i18n'
import { FieldDescription } from '@/shared/ui/components/field'

import { submitApplicationSchema, useSubmitApplicationForm } from './model'

type Form = ReturnType<typeof useSubmitApplicationForm>

export function SubmitApplicationFields({ form }: { form: Form }) {
  const { t } = useTranslation()
  const options = DOCUMENT_TYPES.map(value => ({
    value,
    label: t(`application.documentType.${value}`),
  }))

  return (
    <>
      <form.AppField
        name="documentType"
        validators={{ onDynamic: submitApplicationSchema.shape.documentType }}
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
        validators={{ onDynamic: submitApplicationSchema.shape.address }}
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
        validators={{ onDynamic: submitApplicationSchema.shape.description }}
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
        name="file"
        validators={{ onDynamic: submitApplicationSchema.shape.file }}
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
