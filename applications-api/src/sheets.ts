// Листы готовит checker; applications-api проверяет доступ и проксирует изображения.
const BACKEND = (process.env.BACKEND_URL ?? 'http://backend:8000').replace(/\/+$/, '')
const FILES = (process.env.FILES_URL ?? 'http://checker:8001/files').replace(/\/+$/, '')

interface Sheet {
  index: number
  number: number
  image: string
  width: number
  height: number
  kind_title: string
  notes?: string[]
}
interface Finding {
  id: string
  rule: string
  severity: string
  message: string
  page: number | null
  bbox?: [number, number, number, number] | null
}
interface Run {
  file?: string
  state: string
  report?: { pages: Sheet[]; findings: Finding[] }
}
async function json<T>(url: string): Promise<T> {
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) })
  if (!response.ok) throw new Error(`Сервис листов: HTTP ${response.status}`)
  return response.json() as Promise<T>
}
export async function readSheets(packageId: string, withFindings: boolean) {
  const pkg = await json<{ state: string; documents: Array<{ id: string; file?: string }> }>(`${BACKEND}/api/packages/${encodeURIComponent(packageId)}`)
  const documents = await Promise.all(pkg.documents.map(async (document, index) => {
    const run = await json<Run>(`${BACKEND}/api/checks/${encodeURIComponent(document.id)}`)
    return {
      index,
      id: document.id,
      name: run.file ?? document.file ?? `Документ ${index + 1}`,
      pages: (run.report?.pages ?? []).map(({ image: _image, ...page }) => page),
      findings: withFindings ? (run.report?.findings ?? []).filter(f => f.severity === 'error' || f.severity === 'warning') : [],
    }
  }))
  return { state: pkg.state, documents }
}
export async function readSheetImage(packageId: string, fileIndex: number, pageIndex: number) {
  const pkg = await json<{ documents: Array<{ id: string }> }>(`${BACKEND}/api/packages/${encodeURIComponent(packageId)}`)
  const document = pkg.documents[fileIndex]
  if (!document) return undefined
  const run = await json<Run>(`${BACKEND}/api/checks/${encodeURIComponent(document.id)}`)
  const page = run.report?.pages.find(page => page.index === pageIndex)
  if (!page) return undefined
  const relative = page.image.split('/')
  if (relative.some(part => !part || part === '.' || part === '..')) return undefined
  const response = await fetch(`${FILES}/${encodeURIComponent(document.id)}/${relative.map(encodeURIComponent).join('/')}`, { signal: AbortSignal.timeout(15000) })
  return response.ok ? response : undefined
}
