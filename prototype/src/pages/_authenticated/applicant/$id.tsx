import { IconArrowLeft, IconChevronRight } from '@tabler/icons-react'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { toast } from 'sonner'

import {
  ApplicationNumber,
  applicationQueryOptions,
  ApplicationProperties,
  DecisionCard,
  formatApplicationNumber,
  VersionHistory,
} from '@/entities/application'
import { VersionCheckResult } from '@/features/application/precheck'
import { useTranslation } from '@/shared/i18n'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/shared/ui/components/collapsible'
import { Skeleton } from '@/shared/ui/components/skeleton'
import { DraftEditor } from '@/widgets/application-draft'

export const Route = createFileRoute('/_authenticated/applicant/$id')({
  component: ApplicationPage,
})

function ApplicationPage() {
  const { t } = useTranslation()
  const { id } = Route.useParams()
  const { data, isPending, isError } = useQuery(applicationQueryOptions(id))

  if (data?.status === 'draft') {
    return (
      <main className="flex min-h-0 w-full flex-1 flex-col overflow-hidden p-3 sm:p-4">
        <DraftEditor
          application={data}
          onCreated={() => undefined}
          onSubmitted={application =>
            toast.success(
              t('applicant.submit.success', {
                number: formatApplicationNumber(application.number),
              }),
            )
          }
        />
      </main>
    )
  }

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6 sm:px-6">
      <Link
        to="/applicant"
        className="inline-flex items-center gap-1 self-start text-sm text-muted-foreground hover:text-foreground"
      >
        <IconArrowLeft className="size-4" />
        {t('application.back')}
      </Link>
      {isPending && <Skeleton className="h-40" />}
      {isError && (
        <p className="text-destructive">{t('application.notFound')}</p>
      )}
      {data && (
        <>
          <div className="flex flex-col gap-1">
            <ApplicationNumber number={data.number} />
            <h1 className="text-xl font-semibold">{data.address}</h1>
            {data.description && (
              <p className="text-sm whitespace-pre-wrap text-muted-foreground">
                {data.description}
              </p>
            )}
          </div>
          <ApplicationProperties application={data} />
          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-medium">
              {t('application.decision.title')}
            </h2>
            <DecisionCard decision={data.decision} />
          </section>
          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-medium">
              {t('application.versions.title')}
            </h2>
            <VersionHistory
              application={data}
              showSummary
              renderDetails={version =>
                version.checked ? (
                  <Collapsible>
                    <CollapsibleTrigger className="group inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                      <IconChevronRight className="size-3.5 transition-transform group-aria-expanded:rotate-90" />
                      {t('applicant.precheck.title')}
                    </CollapsibleTrigger>
                    <CollapsibleContent className="pt-2">
                      <VersionCheckResult
                        applicationId={data.id}
                        versionId={version.id}
                        withAdvice={false}
                      />
                    </CollapsibleContent>
                  </Collapsible>
                ) : null
              }
            />
          </section>
        </>
      )}
    </main>
  )
}
