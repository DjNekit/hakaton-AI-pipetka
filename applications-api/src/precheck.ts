const BACKEND_URL = (process.env.BACKEND_URL ?? 'http://backend:8000').replace(
  /\/+$/,
  '',
)
const FILES_URL = (
  process.env.FILES_URL ?? 'http://checker:8001/files'
).replace(/\/+$/, '')
const CHAT_URL = (process.env.CHAT_URL ?? 'http://chat:3000').replace(/\/+$/, '')

export class UpstreamError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

async function upstream<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init).catch(() => null)
  if (!response) throw new UpstreamError(503, 'checker_unavailable')
  const body = (await response.json().catch(() => null)) as
    | (T & { error?: string })
    | null
  if (!response.ok || !body) {
    throw new UpstreamError(
      response.status >= 500 ? 502 : response.status,
      body?.error ?? 'checker_error',
    )
  }
  return body
}

export async function startCheck(files: File[], documentType: string) {
  const form = new FormData()
  for (const file of files) form.append('files', file, file.name)
  const { uploads } = await upstream<{
    uploads: Array<{ id: string; name: string; kind: string }>
  }>(`${FILES_URL}/uploads`, { method: 'POST', body: form })
  const pdfs = uploads.filter(upload => upload.kind === 'pdf')
  if (pdfs.length !== files.length) throw new UpstreamError(400, 'invalid_file')
  const pkg = await upstream<{ id: string }>(`${BACKEND_URL}/api/packages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ uploads: pdfs, title: files[0].name, service_type: documentType }),
  })
  return pkg.id
}

interface PackageDocument {
  id: string
  state: string
  stage?: string
  progress?: number
}

interface CheckFinding {
  rule: string
  title?: string
  ref?: string
  severity: string
  message: string
  page: number | null
  expected?: string | null
  actual?: string | null
}

interface PackageCheck {
  rule: string
  title: string
  ref?: string
  status: string
  note?: string
  evidence?: Array<{ file?: string; page?: number; quote?: string; note?: string }>
}

interface CheckRun {
  report?: {
    document_kind?: string
    verdict?: string
    findings: CheckFinding[]
  }
}

export interface CheckResult {
  checkId: string
  documentKind: 'passport' | 'signage'
  verdict: string
  findings: Array<{
    rule: string
    title: string
    ref: string
    severity: 'error' | 'warning'
    message: string
    page: number | null
    expected: string | null
    actual: string | null
  }>
}

export interface CheckStatus {
  state: string
  stage: string
  progress: number
  result: CheckResult | null
}

export async function readCheck(packageId: string): Promise<CheckStatus> {
  const pkg = await upstream<{ state: string; documents: PackageDocument[]; checks?: PackageCheck[]; verdict?: string }>(
    `${BACKEND_URL}/api/packages/${packageId}`,
  )
  const document = pkg.documents.find(doc => doc.state !== 'done') ?? pkg.documents[0]
  const base = {
    state: document?.state ?? pkg.state,
    stage: document?.stage ?? '',
    progress: document?.progress ?? 0,
  }
  if (pkg.documents.some(doc => doc.state === 'error') || pkg.state === 'error') {
    return { ...base, state: 'error', result: null }
  }
  // Документы завершаются раньше сводной проверки: ждём результат всего пакета.
  if (pkg.state !== 'done' || !document || pkg.documents.some(doc => doc.state !== 'done')) return { ...base, result: null }
  if (!pkg.checks?.length) throw new UpstreamError(502, 'checker_result_missing')
  const runs = await Promise.all(pkg.documents.map(doc => upstream<CheckRun>(
    `${BACKEND_URL}/api/checks/${doc.id}`,
  )))
  const run = runs[0]
  if (runs.some(run => !run.report)) throw new UpstreamError(502, 'checker_result_missing')
  const findings = runs.flatMap(run => run.report?.findings ?? [])
  const documentFindings = findings
    .filter(f => f.severity === 'error' || f.severity === 'warning')
    .map(f => ({
      rule: f.rule, title: f.title ?? f.rule, ref: f.ref ?? '',
      severity: f.severity as 'error' | 'warning', message: f.message,
      page: typeof f.page === 'number' ? f.page + 1 : null,
      expected: f.expected ?? null, actual: f.actual ?? null,
    }))
  const packageFindings = pkg.checks
    .filter(check => check.status === 'fail' || check.status === 'warn')
    .map(check => ({
      rule: check.rule, title: check.title, ref: check.ref ?? '',
      severity: (check.status === 'fail' ? 'error' : 'warning') as 'error' | 'warning',
      message: [check.title, check.note, ...(check.evidence ?? []).map(e =>
        [e.file, e.page ? `стр. ${e.page}` : '', e.quote ?? e.note].filter(Boolean).join(': '),
      )].filter(Boolean).join(' — '),
      // У пункта пакета могут быть доказательства из нескольких PDF и страниц.
      page: null, expected: null, actual: null,
    }))
  const allFindings = [...documentFindings, ...packageFindings]
  const verdict = allFindings.some(f => f.severity === 'error') || pkg.verdict === 'fail'
    ? 'fail' : allFindings.length || pkg.verdict === 'warn' ? 'warn' : 'pass'
  return {
    ...base,
    result: {
      checkId: document.id,
      documentKind:
        run.report?.document_kind === 'signage' ? 'signage' : 'passport',
      verdict,
      findings: allFindings,
    },
  }
}

export function adviceFor(checkId: string) {
  return upstream<{ text: string; provider: string; model: string }>(
    `${CHAT_URL}/chat/checks/${checkId}/advice`,
    { method: 'POST' },
  )
}
