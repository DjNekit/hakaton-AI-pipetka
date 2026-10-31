import { IconCheck, IconX } from '@tabler/icons-react'

import { useTranslation } from '@/shared/i18n'
import { Button } from '@/shared/ui/components/button'

import { rejectionCommentValidator, useDecisionForm } from './model'

type Form = ReturnType<typeof useDecisionForm>

export function DecisionFields({ form }: { form: Form }) {
  const { t } = useTranslation()
  const submitAs = (decision: 'approved' | 'rejected') => {
    form.setFieldValue('decision', decision)
    void form.handleSubmit()
  }

  return (
    <div className="flex flex-col gap-4">
      <form.AppField
        name="comment"
        validators={{ onDynamic: rejectionCommentValidator }}
        children={field => (
          <field.Root>
            <field.Label>{t('normcontrol.decide.comment')}</field.Label>
            <field.Textarea
              rows={3}
              placeholder={t('normcontrol.decide.commentPlaceholder')}
            />
            <field.Error />
          </field.Root>
        )}
      />
      <form.Subscribe selector={state => state.isSubmitting}>
        {isSubmitting => (
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              disabled={isSubmitting}
              onClick={() => submitAs('approved')}
            >
              <IconCheck />
              {t('normcontrol.decide.approve')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={isSubmitting}
              onClick={() => submitAs('rejected')}
            >
              <IconX />
              {t('normcontrol.decide.reject')}
            </Button>
          </div>
        )}
      </form.Subscribe>
    </div>
  )
}
