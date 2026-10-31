import { IconFileSearch, IconSend, IconUpload } from '@tabler/icons-react'
import { useEffect, useRef, useState } from 'react'

import {
  ApplicationSheetViewer,
  formatApplicationNumber,
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
  const [panel, setPanel] = useState<'fields' | 'check'>(application ? 'check' : 'fields')
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
    setPanel('check')
    form.setFieldValue('files', [])
    if (!application) onCreated(updated)
  }

  const uploadNew = () => {
    setPanel('fields')
    requestAnimationFrame(() => fileZone.current?.querySelector<HTMLInputElement>('input[type=file]')?.click())
  }

  return (
    <div className="grid h-full min-h-0 flex-1 grid-rows-[minmax(0,1fr)_minmax(0,1fr)] gap-3 overflow-hidden md:grid-cols-[22rem_minmax(0,1fr)] md:grid-rows-1">
      <section className="flex min-h-0 min-w-0 flex-col gap-3 rounded-xl border p-3">
        <h1 className="shrink-0 truncate text-base font-semibold">
          {application ? t('applicant.draft.title', { number: formatApplicationNumber(application.number) }) : t('applicant.submit.title')}
        </h1>
        <nav className="flex shrink-0 gap-2" aria-label="Работа с заявкой">
          <Button type="button" size="sm" variant={panel === 'fields' ? 'default' : 'outline'} onClick={() => setPanel('fields')}>Данные и файлы</Button>
          <Button type="button" size="sm" variant={panel === 'check' ? 'default' : 'outline'} onClick={() => setPanel('check')}>Проверка</Button>
        </nav>
        <div className={panel === 'fields' ? 'min-h-0 flex-1 overflow-y-auto' : 'hidden'}>
          <form.AppForm>
            <form.Root className="flex flex-col gap-4">
              <div ref={fileZone} className="flex flex-col gap-4">
                <DraftFields form={form} fileKey={String(versions.length)} />
              </div>
              <form.Subscribe selector={state => state.values.files}>
                {files => (
                  <Button type="button" className="self-start" disabled={!files.length || checkVersion.isPending}
                    aria-busy={checkVersion.isPending} onClick={() => void runCheck()}>
                    <SpinnerAddon enabled={checkVersion.isPending} /><IconFileSearch />
                    {versions.length ? t('applicant.draft.checkNew') : t('applicant.draft.check')}
                  </Button>
                )}
              </form.Subscribe>
            </form.Root>
          </form.AppForm>
        </div>
        <div className={panel === 'check' ? 'flex min-h-0 flex-1 flex-col gap-3' : 'hidden'}>
          {versions.length > 0 && <select aria-label="Версия документов" value={selectedId ?? ''}
            className="w-full shrink-0 rounded-lg border bg-background p-2 text-sm"
            onChange={event => setSelectedId(event.target.value)}>
            {versions.map(version => <option key={version.id} value={version.id}>Версия {version.version} · {version.fileName}</option>)}
          </select>}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {application && selectedId ? <VersionCheckResult key={selectedId} applicationId={application.id} versionId={selectedId} />
              : <p className="text-sm text-muted-foreground">{t('applicant.draft.empty')}</p>}
          </div>
          {application && selectedId && <div className="shrink-0 border-t pt-3">
            <VersionActions application={application} versionId={selectedId} submitting={submitDraft.isPending}
              onSubmit={() => void form.handleSubmit()} onUploadNew={uploadNew} />
          </div>}
        </div>
      </section>
      {application && selectedId ? <ApplicationSheetViewer key={selectedId} application={application}
        version={versions.find(version => version.id === selectedId)} />
        : <div className="grid min-h-0 place-content-center rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">Загрузите документы и запустите проверку, чтобы увидеть листы</div>}
    </div>
  )
}
