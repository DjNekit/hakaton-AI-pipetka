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

export async function startCheck(file: File) {
  const form = new FormData()
  form.append('files', file, file.name)
  const { uploads } = await upstream<{
    uploads: Array<{ id: string; name: string; kind: string }>
  }>(`${FILES_URL}/uploads`, { method: 'POST', body: form })
  const pdf = uploads.find(upload => upload.kind === 'pdf')
  if (!pdf) throw new UpstreamError(400, 'invalid_file')
  const pkg = await upstream<{ id: string }>(`${BACKEND_URL}/api/packages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ uploads: [pdf], title: file.name }),
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
  const pkg = await upstream<{ state: string; documents: PackageDocument[] }>(
    `${BACKEND_URL}/api/packages/${packageId}`,
  )
  const document = pkg.documents[0]
  const base = {
    state: document?.state ?? pkg.state,
    stage: document?.stage ?? '',
    progress: document?.progress ?? 0,
  }
  if (!document || document.state !== 'done') return { ...base, result: null }
  const run = await upstream<CheckRun>(
    `${BACKEND_URL}/api/checks/${document.id}`,
  )
  return {
    ...base,
    result: {
      checkId: document.id,
      documentKind:
        run.report?.document_kind === 'signage' ? 'signage' : 'passport',
      verdict: run.report?.verdict ?? 'pass',
      findings: (run.report?.findings ?? [])
        .filter(f => f.severity === 'error' || f.severity === 'warning')
        .map(f => ({
          rule: f.rule,
          title: f.title ?? f.rule,
          ref: f.ref ?? '',
          severity: f.severity as 'error' | 'warning',
          message: f.message,
          page: f.page === null ? null : f.page + 1,
          expected: f.expected ?? null,
          actual: f.actual ?? null,
        })),
    },
  }
}

export function adviceFor(checkId: string) {
  return upstream<{ text: string; provider: string; model: string }>(
    `${CHAT_URL}/chat/checks/${checkId}/advice`,
    { method: 'POST' },
  )
}
