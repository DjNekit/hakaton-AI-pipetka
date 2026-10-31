import { REVIEW_STATUSES } from '@/entities/application'
import { useTranslation } from '@/shared/i18n'

import { reviewSchema, useReviewForm } from './model'

type Form = ReturnType<typeof useReviewForm>

export function ReviewFields({ form }: { form: Form }) {
  const { t } = useTranslation()
  const options = REVIEW_STATUSES.map(value => ({
    value,
    label: t(`application.status.${value}`),
  }))

  return (
    <>
      <form.AppField
        name="status"
        validators={{ onDynamic: reviewSchema.shape.status }}
        children={field => (
          <field.Root>
            <field.Label>{t('application.fields.status')}</field.Label>
            <field.Select options={options} className="w-full" />
            <field.Error />
          </field.Root>
        )}
      />
      <form.AppField
        name="reviewComment"
        validators={{ onDynamic: reviewSchema.shape.reviewComment }}
        children={field => (
          <field.Root>
            <field.Label>{t('application.fields.reviewComment')}</field.Label>
            <field.Textarea
              rows={5}
              placeholder={t('approver.review.commentPlaceholder')}
            />
            <field.Error />
          </field.Root>
        )}
      />
    </>
  )
}
