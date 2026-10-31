import { IconChevronRight } from '@tabler/icons-react'

import {
  RECOMMENDATIONS,
  VerdictIcon,
  VERDICTS,
  type ChecklistItem,
} from '@/entities/application'
import { useTranslation } from '@/shared/i18n'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/shared/ui/components/collapsible'

import {
  recommendationFieldValidator,
  useApproverReviewForm,
  verdictFieldValidator,
} from './model'

type Form = ReturnType<typeof useApproverReviewForm>

function groupBySection(checklist: ChecklistItem[]) {
  const groups = new Map<
    string,
    Array<{ item: ChecklistItem; index: number }>
  >()
  checklist.forEach((item, index) => {
    groups.set(item.section, [
      ...(groups.get(item.section) ?? []),
      { item, index },
    ])
  })
  return [...groups]
}

function ChecklistRow({
  form,
  item,
  index,
}: {
  form: Form
  item: ChecklistItem
  index: number
}) {
  const { t } = useTranslation()
  const verdictOptions = VERDICTS.map(verdict => ({
    value: verdict,
    label: (
      <>
        <VerdictIcon verdict={verdict} />
        {t(`application.verdict.${verdict}`)}
      </>
    ),
  }))

  return (
    <li className="flex flex-col gap-2 px-3 py-3">
      <span className="text-sm font-medium">{item.title}</span>
      <Collapsible>
        <CollapsibleTrigger className="group inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <IconChevronRight className="size-3.5 transition-transform group-aria-expanded:rotate-90" />
          {t('approver.review.showCheck')}
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-2 text-xs whitespace-pre-wrap text-muted-foreground">
          {item.check}
          {item.basis && <div className="pt-1">{item.basis}</div>}
        </CollapsibleContent>
      </Collapsible>
      <form.AppField
        name={`items[${index}].verdict`}
        validators={{ onDynamic: verdictFieldValidator }}
        children={field => (
          <field.Root>
            <field.Choice options={verdictOptions} className="flex-wrap" />
            <field.Error />
          </field.Root>
        )}
      />
      <form.Subscribe selector={state => state.values.items[index]?.verdict}>
        {verdict =>
          verdict === 'violation' || verdict === 'unknown' ? (
            <form.AppField
              name={`items[${index}].comment`}
              children={field => (
                <field.Root>
                  <field.Textarea
                    rows={2}
                    placeholder={t('approver.review.commentPlaceholder')}
                  />
                </field.Root>
              )}
            />
          ) : null
        }
      </form.Subscribe>
    </li>
  )
}

export function ApproverReviewFields({
  form,
  checklist,
}: {
  form: Form
  checklist: ChecklistItem[]
}) {
  const { t } = useTranslation()
  const recommendationOptions = RECOMMENDATIONS.map(value => ({
    value,
    label: t(`application.recommendation.${value}`),
  }))

  return (
    <div className="flex flex-col gap-6">
      <form.Subscribe
        selector={state =>
          state.values.items.filter(item => item.verdict).length
        }
      >
        {done => (
          <p className="text-sm text-muted-foreground">
            {t('approver.review.progress', { done, total: checklist.length })}
          </p>
        )}
      </form.Subscribe>
      {groupBySection(checklist).map(([section, rows]) => (
        <section key={section} className="flex flex-col gap-2">
          <h3 className="text-xs font-medium text-muted-foreground uppercase">
            {section}
          </h3>
          <ul className="divide-y rounded-lg border">
            {rows.map(({ item, index }) => (
              <ChecklistRow
                key={item.id}
                form={form}
                item={item}
                index={index}
              />
            ))}
          </ul>
        </section>
      ))}
      <form.AppField
        name="recommendation"
        validators={{ onDynamic: recommendationFieldValidator }}
        children={field => (
          <field.Root>
            <field.Label>{t('approver.review.recommendation')}</field.Label>
            <field.Choice options={recommendationOptions} />
            <field.Error />
          </field.Root>
        )}
      />
      <form.AppField
        name="comment"
        children={field => (
          <field.Root>
            <field.Label>{t('approver.review.summary')}</field.Label>
            <field.Textarea
              rows={3}
              placeholder={t('approver.review.summaryPlaceholder')}
            />
          </field.Root>
        )}
      />
    </div>
  )
}
