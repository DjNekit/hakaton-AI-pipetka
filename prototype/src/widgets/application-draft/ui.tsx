import { IconFileSearch, IconSend, IconUpload } from '@tabler/icons-react'
import { useEffect, useRef, useState } from 'react'

import {
  formatApplicationNumber,
  formatDateTime,
  VersionSummaryLabel,
  type Application,
} from '@/entities/application'
import {
  checkOutcome,
  useVersionCheck,
  VersionCheckResult,
} from '@/features/application/precheck'
import {
  DraftFields,
  useCheckVersion,
  useDraftForm,
  useSubmitDraft,
  type DraftValues,
} from '@/features/application/submit'
import { useTranslation } from '@/shared/i18n'
import { Button } from '@/shared/ui/components/button'
import { SpinnerAddon } from '@/shared/ui/components/spinner-addon'

function VersionActions({
  application,
  versionId,
  submitting,
  onSubmit,
  onUploadNew,
}: {
  application: Application
  versionId: string
  submitting: boolean
  onSubmit: () => void
  onUploadNew: () => void
}) {
  const { t } = useTranslation()
  const check = useVersionCheck(application.id, versionId)
  const outcome = checkOutcome(check.data)
  if (outcome === 'running') return null
  const clean = outcome === 'clean'
  return (
    <div className="flex flex-wrap gap-2">
      <Button
        type="button"
        variant={clean ? 'default' : 'outline'}
        disabled={submitting}
        aria-busy={submitting}
        onClick={onSubmit}
      >
        <SpinnerAddon enabled={submitting} />
        <IconSend />
        {clean
          ? t('applicant.draft.submit')
          : t('applicant.draft.submitAnyway')}
      </Button>
      {!clean && (
        <Button type="button" onClick={onUploadNew}>
          <IconUpload />
          {t('applicant.draft.uploadNew')}
        </Button>
      )}
    </div>
  )
}

export function DraftEditor({
  application,
  onCreated,
  onSubmitted,
}: {
  application?: Application
  onCreated: (application: Application) => void
  onSubmitted: (application: Application) => void
}) {
  const { t } = useTranslation()
  const versions = application?.versions ?? []
  const [selectedId, setSelectedId] = useState(versions[0]?.id)
  const latestId = versions[0]?.id
  useEffect(() => {
    setSelectedId(latestId)
  }, [latestId])
  const fileZone = useRef<HTMLDivElement>(null)
  const checkVersion = useCheckVersion(application?.id)
  const submitDraft = useSubmitDraft(application?.id ?? '')
  const form = useDraftForm(application, async values => {
    if (!application || !selectedId) return
    await submitDraft
      .mutateAsync({ values, versionId: selectedId })
      .then(onSubmitted)
      .catch(() => undefined)
  })

  const runCheck = async () => {
    const errors = await form.validateField('files', 'submit')
    const values = form.state.values as DraftValues
    if (errors.length || !values.files.length) return
    const updated = await checkVersion
      .mutateAsync({ values, files: values.files })
      .catch(() => undefined)
    if (!updated) return
    form.setFieldValue('files', [])
    if (!application) onCreated(updated)
  }

  const uploadNew = () => {
    fileZone.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    fileZone.current
      ?.querySelector<HTMLInputElement>('input[type=file]')
      ?.click()
  }

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <form.AppForm>
        <form.Root className="flex flex-col gap-5">
          <div className="flex flex-col gap-1">
            <h1 className="text-lg font-semibold">
              {application
                ? t('applicant.draft.title', {
                    number: formatApplicationNumber(application.number),
                  })
                : t('applicant.submit.title')}
            </h1>
            <p className="text-sm text-muted-foreground">
              {t('applicant.draft.description')}
            </p>
          </div>
          <div ref={fileZone} className="flex flex-col gap-5">
            <DraftFields form={form} fileKey={String(versions.length)} />
          </div>
          <form.Subscribe selector={state => state.values.files}>
            {file => (
              <Button
                type="button"
                className="self-start"
                disabled={!file.length || checkVersion.isPending}
                aria-busy={checkVersion.isPending}
                onClick={() => void runCheck()}
              >
                <SpinnerAddon enabled={checkVersion.isPending} />
                <IconFileSearch />
                {versions.length
                  ? t('applicant.draft.checkNew')
                  : t('applicant.draft.check')}
              </Button>
            )}
          </form.Subscribe>
        </form.Root>
      </form.AppForm>
      <section className="flex min-w-0 flex-col gap-4 lg:border-l lg:pl-8">
        <h2 className="text-sm font-medium">{t('applicant.precheck.title')}</h2>
        {!application && (
          <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            {t('applicant.draft.empty')}
          </p>
        )}
        {application && (
          <>
            <ul className="divide-y rounded-lg border">
              {versions.map(version => (
                <li key={version.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(version.id)}
                    className={`flex w-full flex-col gap-0.5 px-3 py-2 text-left text-sm transition-colors hover:bg-muted/50 ${selectedId === version.id ? 'bg-muted' : ''}`}
                  >
                    <span className="flex items-center gap-2">
                      <span className="font-medium">
                        {t('application.versions.version', {
                          version: version.version,
                        })}
                      </span>
                      <span className="min-w-0 truncate text-muted-foreground">
                        {version.fileName}
                      </span>
                    </span>
                    <span className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
                      <span>{formatDateTime(version.createdAt)}</span>
                      <VersionSummaryLabel version={version} />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {selectedId && (
              <>
                <VersionCheckResult
                  key={selectedId}
                  applicationId={application.id}
                  versionId={selectedId}
                />
                <VersionActions
                  application={application}
                  versionId={selectedId}
                  submitting={submitDraft.isPending}
                  onSubmit={() => void form.handleSubmit()}
                  onUploadNew={uploadNew}
                />
              </>
            )}
          </>
        )}
      </section>
    </div>
  )
}
