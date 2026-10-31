// Реальные результаты checker. Модель не определяет соответствие требованиям.
import { getApplication, readApplicationFiles, setAiReview } from './applications'
import type { AiReview, AiReviewItem, DocumentType } from './model'

const BACKEND = (process.env.BACKEND_URL ?? 'http://backend:8000').replace(/\/+$/, '')
const FILES = (process.env.FILES_URL ?? 'http://checker:8001/files').replace(/\/+$/, '')

interface PackageCheck {
  rule: string
  section?: string
  title: string
  ref: string
  status: string
  note?: string
  evidence?: Array<{ file: string; page?: number; note?: string; quote?: string }>
}

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(30000) })
  if (!response.ok) throw new Error(`Сервис проверки: HTTP ${response.status}`)
  return response.json() as Promise<T>
}

export async function checklistFor(type: DocumentType) {
  const { package_checklists: catalog } = await json<{
    package_checklists: { sections: Record<string, Array<{
      id: string; title: string; requirement: string; ref: string; options: string[]
    }>> }
  }>(`${BACKEND}/api/rules`)
  const sections = ['intake', ...(type === 'facade' ? ['special'] : []), type]
  return sections.flatMap(section => catalog.sections[section].map(item => ({
    id: item.id, section, title: item.title, check: item.requirement,
    basis: item.ref, options: item.options,
  })))
}

export async function runAiReview(id: string) {
  const application = getApplication(id)
  if (!application) return
  const base: AiReview = { state: 'running', summary: '', items: [], model: 'rules',
    packageId: application.aiReview?.packageId }
  setAiReview(id, base)
  try {
    if (!base.packageId) {
      const uploads: unknown[] = []
      for (const file of readApplicationFiles(id)) {
        const body = new FormData()
        body.append('files', new Blob([new Uint8Array(file.data)], { type: 'application/pdf' }), file.name)
        const uploaded = await json<{ uploads: unknown[]; errors?: string[] }>(`${FILES}/uploads`, { method: 'POST', body })
        if (uploaded.errors?.length) throw new Error(`Не принят документ ${file.name}: ${uploaded.errors.join('; ')}`)
        uploads.push(...uploaded.uploads)
      }
      const pkg = await json<{ id: string }>(`${BACKEND}/api/packages`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ uploads, title: application.address,
          service_type: application.documentType }),
      })
      base.packageId = pkg.id
      setAiReview(id, base)
    }
    const deadline = Date.now() + 30 * 60 * 1000
    while (Date.now() < deadline) {
      const pkg = await json<{ state: string; checks: PackageCheck[] }>(`${BACKEND}/api/packages/${base.packageId}`)
      if (pkg.state === 'done') {
        const items: AiReviewItem[] = pkg.checks.map(check => {
          const verdict = check.status === 'fail' ? 'violation' : check.status === 'ok' ? 'ok' : 'unknown'
          const evidence = (check.evidence ?? []).map(e =>
            `${e.file}${e.page ? `, стр. ${e.page}` : ''}: ${e.quote ?? e.note ?? ''}`).join('\n')
          return { id: check.rule, section: check.section ?? 'Пакет документов', title: check.title,
            basis: check.ref, verdict, result: verdict === 'violation' ? 'Есть замечания' :
              verdict === 'ok' ? 'Соответствует' : 'Требуется проверка',
            comment: [check.note, evidence].filter(Boolean).join('\n') }
        })
        const violations = items.filter(i => i.verdict === 'violation').length
        const unknown = items.filter(i => i.verdict === 'unknown').length
        setAiReview(id, { ...base, state: 'done', items,
          summary: `Проверен пакет документов. Замечаний: ${violations}. Требуют проверки инспектором: ${unknown}.`,
          finishedAt: new Date().toISOString() })
        return
      }
      await new Promise(resolve => setTimeout(resolve, 2000))
    }
    throw new Error('Превышено время ожидания проверки пакета')
  } catch (error) {
    setAiReview(id, { ...base, state: 'failed',
      error: error instanceof Error ? error.message : String(error),
      finishedAt: new Date().toISOString() })
  }
}
