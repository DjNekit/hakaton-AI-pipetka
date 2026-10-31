// Сервис applications-api: серверная логика нового интерфейса (клиент — prototype/, адрес /new).
//   /new/api/auth/*                     better-auth: регистрация, вход, коды, сброс пароля
//   GET /new/api/applications           заявки (заявитель — свои с черновиками, сотрудники — поданные)
//   GET /new/api/applications/:id       заявка (согласующему — без проверки ИИ, заявителю — только решение)
//   POST /new/api/applications/drafts               черновик + версия 1 файла, проверка checker
//   POST /new/api/applications/:id/versions         новая версия файла черновика, проверка checker
//   GET /new/api/applications/:id/versions/:vid/check   ход и замечания проверки версии
//   POST /new/api/applications/:id/versions/:vid/advice что исправить — текст GigaChat (сервис chat)
//   GET /new/api/applications/:id/versions/:vid/file    PDF версии
//   POST /new/api/applications/:id/submit           отправить выбранную версию на автоматическую проверку
//   GET /new/api/applications/:id/checklist        пункты чек-листа для ручной проверки (после автоматической)
//   POST /new/api/applications/:id/approver-review проверка согласующего (независимо от ИИ)
//   POST /new/api/applications/:id/decision        решение нормоконтролёра
//   GET /new/api/applications/:id/file  PDF заявки
//   POST /new/api/chat                  ассистент: поток AG-UI от сервиса chat (GigaChat API)
//   GET /new/api/dev/mailbox/:email     последнее «письмо» (коды, ссылки) — только вне продакшена
//   GET /new/api/health
import { serve } from '@hono/node-server'
import { getMigrations } from 'better-auth/db/migration'
import { Hono } from 'hono'
import { seedDemoAccounts } from './seed-accounts'
import { chatStatus } from './chat-status'
import { readSheets, readSheetImage } from './sheets'
import { streamSSE } from 'hono/streaming'
import { subscribeApplications } from './events'

import { checklistFor, runAiReview } from './ai-review'
import {
  canAccess,
  addVersion,
  createDraft,
  decideApplication,
  findVersion,
  readVersionFile,
  setVersionSummary,
  submitDraft,
  forViewer,
  getApplication,
  listApplications,
  readApplicationFile,
  submitApproverReview,
} from './applications'
import { auth } from './auth'
import { getCurrentUser, jsonError } from './current-user'
import { readMailbox } from './mailbox'
import { adviceFor, checklistAssistant, readCheck, readLocations, startCheck, UpstreamError } from './precheck'
import {
  approverReviewSchema,
  decisionSchema,
  draftFieldsSchema,
  submitSchema,
} from './model'

const MAX_FILE_SIZE = 50 * 1024 * 1024
const CHAT_URL = (process.env.CHAT_URL ?? 'http://chat:3000').replace(/\/+$/, '')
const PRODUCTION = process.env.NODE_ENV === 'production'

function text(value: FormDataEntryValue | null) {
  return typeof value === 'string' ? value.trim() : ''
}

const app = new Hono().basePath('/new/api')

app.get('/health', c => c.json({ ok: true }))

app.get('/chat/health', async c => {
  const user = await getCurrentUser(c.req.raw)
  if (!user) return jsonError(401, 'unauthorized')
  c.header('Cache-Control', 'no-store')
  return c.json(await chatStatus(CHAT_URL))
})

app.on(['GET', 'POST'], '/auth/*', c => auth.handler(c.req.raw))

// Поток содержит только идентификаторы: данные по-прежнему проходят forViewer().
app.get('/events', async c => {
  const user = await getCurrentUser(c.req.raw)
  if (!user) return jsonError(401, 'unauthorized')
  c.header('X-Accel-Buffering', 'no')
  c.header('Cache-Control', 'no-cache, no-transform')
  return streamSSE(c, async stream => {
    let closed = false
    let pending = Promise.resolve()
    const unsubscribe = subscribeApplications(user, id => {
      pending = pending.then(async () => {
        if (!closed) await stream.writeSSE({ event: 'application', data: JSON.stringify({ id }) })
      }).catch(() => { closed = true })
    })
    stream.onAbort(() => { closed = true; unsubscribe() })
    try {
      await stream.writeSSE({ event: 'ready', data: '{}', retry: 3000 })
      while (!closed && !stream.aborted) {
        await stream.sleep(15000)
        if (closed || stream.aborted) break
        const current = await getCurrentUser(c.req.raw)
        if (!current || current.id !== user.id || current.role !== user.role) {
          await stream.writeSSE({ event: 'session-ended', data: '{}' })
          break
        }
        await stream.writeSSE({ event: 'heartbeat', data: '{}' })
      }
    } finally {
      closed = true
      unsubscribe()
    }
  })
})

app.get('/applications', async c => {
  const user = await getCurrentUser(c.req.raw)
  if (!user) return jsonError(401, 'unauthorized')
  return c.json(
    listApplications(user.role === 'applicant' ? { applicantId: user.id } : {}).map(
      item => forViewer(user, item),
    ),
  )
})

app.get('/applications/:id', async c => {
  const user = await getCurrentUser(c.req.raw)
  if (!user) return jsonError(401, 'unauthorized')
  const application = getApplication(c.req.param('id'))
  if (!application || !canAccess(user, application)) {
    return jsonError(404, 'not_found')
  }
  return c.json(forViewer(user, application))
})

async function readUpload(request: Request) {
  const form = await request.formData()
  const description = draftFieldsSchema.shape.description.safeParse(text(form.get('description')))
  const files = [...form.getAll('files'), ...form.getAll('file')]
  const file = files[0]
  if (!description.success) return { error: 'invalid_fields' as const }
  if (!files.length || files.length > 20 || files.some(file => !(file instanceof File) || file.type !== 'application/pdf')) {
    return { error: 'invalid_file' as const }
  }
  if (files.some(file => (file as File).size > MAX_FILE_SIZE)) return { error: 'file_too_large' as const }
  return { fields: { description: description.data }, file: file as File, files: files as File[] }
}

function upstreamError(error: unknown) {
  if (error instanceof UpstreamError) return jsonError(error.status, error.message)
  throw error
}

async function ownDraft(request: Request, id: string) {
  const user = await getCurrentUser(request)
  if (!user) return { response: jsonError(401, 'unauthorized') }
  const application = getApplication(id)
  if (!application || application.applicantId !== user.id) {
    return { response: jsonError(404, 'not_found') }
  }
  return { user, application }
}

app.post('/applications/drafts', async c => {
  const user = await getCurrentUser(c.req.raw)
  if (!user) return jsonError(401, 'unauthorized')
  if (user.role !== 'applicant') return jsonError(403, 'forbidden')
  const upload = await readUpload(c.req.raw)
  if (upload.error) return jsonError(400, upload.error)
  try {
    const detected = await startCheck(upload.files)
    const fields = { ...upload.fields, documentType: detected.documentType, address: detected.address }
    const draft = await createDraft(user, fields, upload.file, detected.packageId, upload.files.slice(1))
    return c.json(forViewer(user, draft), 201)
  } catch (error) {
    return upstreamError(error)
  }
})

app.post('/applications/:id/versions', async c => {
  const owned = await ownDraft(c.req.raw, c.req.param('id'))
  if (owned.response) return owned.response
  if (owned.application.status !== 'draft') return jsonError(409, 'invalid_state')
  const upload = await readUpload(c.req.raw)
  if (upload.error) return jsonError(400, upload.error)
  try {
    const detected = await startCheck(upload.files)
    const fields = { ...upload.fields, documentType: detected.documentType, address: detected.address }
    const draft = await addVersion(
      owned.application.id,
      fields,
      upload.file,
      detected.packageId,
      upload.files.slice(1),
    )
    return c.json(forViewer(owned.user, draft), 201)
  } catch (error) {
    return upstreamError(error)
  }
})

app.get('/applications/:id/versions/:vid/check', async c => {
  const owned = await ownDraft(c.req.raw, c.req.param('id'))
  if (owned.response) return owned.response
  const version = findVersion(owned.application.id, c.req.param('vid'))
  if (!version) return jsonError(404, 'not_found')
  if (!version.packageId) return jsonError(404, 'not_checked')
  try {
    const status = await readCheck(version.packageId)
    if (status.result) {
      const summary = {
        errors: status.result.findings.filter(f => f.severity === 'error').length,
        warnings: status.result.findings.filter(f => f.severity === 'warning').length,
      }
      if (version.summary !== JSON.stringify(summary)) setVersionSummary(version.id, summary)
    }
    return c.json(status)
  } catch (error) {
    return upstreamError(error)
  }
})

app.on(['GET', 'POST'], '/applications/:id/versions/:vid/llm-review', async c => {
  const owned = await ownDraft(c.req.raw, c.req.param('id'))
  if (owned.response) return owned.response
  const version = findVersion(owned.application.id, c.req.param('vid'))
  if (!version?.packageId) return jsonError(404, 'not_found')
  try {
    return c.json(await checklistAssistant(version.packageId, c.req.method === 'POST'))
  } catch (error) { return upstreamError(error) }
})

app.post('/applications/:id/versions/:vid/advice', async c => {
  const owned = await ownDraft(c.req.raw, c.req.param('id'))
  if (owned.response) return owned.response
  const version = findVersion(owned.application.id, c.req.param('vid'))
  if (!version?.packageId) return jsonError(404, 'not_found')
  try {
    const status = await readCheck(version.packageId)
    if (!status.result) return jsonError(409, 'not_ready')
    return c.json(await adviceFor(status.result.checkId))
  } catch (error) {
    return upstreamError(error)
  }
})

async function sheetsResponse(request: Request, id: string, versionId?: string) {
  const user = await getCurrentUser(request)
  if (!user) return jsonError(401, 'unauthorized')
  const application = getApplication(id)
  if (!application || !canAccess(user, application)) return jsonError(404, 'not_found')
  const version = versionId ? findVersion(id, versionId) : undefined
  if (versionId && !version) return jsonError(404, 'not_found')
  const packageId = versionId
    ? version?.packageId
    : application.aiReview?.packageId ?? (application.submittedVersionId
      ? findVersion(id, application.submittedVersionId)?.packageId : undefined)
  if (!packageId) return Response.json({ state: 'pending', documents: [] })
  const url = new URL(request.url)
  try {
    if (url.searchParams.has('page')) {
      const file = Number(url.searchParams.get('file') ?? 0)
      const page = Number(url.searchParams.get('page'))
      if (!Number.isInteger(file) || file < 0 || !Number.isInteger(page) || page < 0) return jsonError(400, 'invalid_fields')
      const image = await readSheetImage(packageId, file, page)
      if (!image) return jsonError(404, 'not_found')
      return new Response(image.body, { headers: {
        'Content-Type': image.headers.get('content-type') ?? 'image/png',
        'Cache-Control': 'private, max-age=300',
        'X-Content-Type-Options': 'nosniff',
      } })
    }
    return Response.json(await readSheets(packageId, user.role !== 'approver'))
  } catch {
    return jsonError(503, 'checker_unavailable')
  }
}

app.get('/applications/:id/sheets', c => sheetsResponse(c.req.raw, c.req.param('id')))
app.get('/applications/:id/versions/:vid/sheets', c => sheetsResponse(c.req.raw, c.req.param('id'), c.req.param('vid')))

app.get('/applications/:id/versions/:vid/file', async c => {
  const user = await getCurrentUser(c.req.raw)
  if (!user) return jsonError(401, 'unauthorized')
  const application = getApplication(c.req.param('id'))
  if (!application || !canAccess(user, application)) {
    return jsonError(404, 'not_found')
  }
  const index = Number(c.req.query('index') ?? 0)
  if (!Number.isInteger(index) || index < 0) return jsonError(400, 'invalid_fields')
  const file = readVersionFile(application.id, c.req.param('vid'), index)
  if (!file) return jsonError(404, 'not_found')
  return new Response(new Uint8Array(file.data), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(file.name)}`,
    },
  })
})

app.post('/applications/:id/submit', async c => {
  const owned = await ownDraft(c.req.raw, c.req.param('id'))
  if (owned.response) return owned.response
  const body = submitSchema.safeParse(await c.req.json().catch(() => null))
  if (!body.success) return jsonError(400, 'invalid_fields')
  const { versionId, description } = body.data
  const fields = { documentType: owned.application.documentType, address: owned.application.address, description }
  const result = submitDraft(owned.application.id, versionId, fields)
  if (result.error) {
    return jsonError(result.error === 'not_found' ? 404 : 409, result.error)
  }
  void runAiReview(result.application.id)
  return c.json(forViewer(owned.user, result.application))
})

app.get('/applications/:id/locations', async c => {
  const user = await getCurrentUser(c.req.raw)
  if (!user) return jsonError(401, 'unauthorized')
  if (user.role === 'approver') return jsonError(403, 'forbidden')
  const application = getApplication(c.req.param('id'))
  if (!application || !canAccess(user, application)) return jsonError(404, 'not_found')
  const packageId = application.aiReview?.packageId ?? (application.submittedVersionId
    ? findVersion(application.id, application.submittedVersionId)?.packageId : undefined)
  if (!packageId) return c.json({ locations: {} })
  try { return c.json(await readLocations(packageId)) }
  catch (error) { return upstreamError(error) }
})

app.get('/applications/:id/checklist', async c => {
  const user = await getCurrentUser(c.req.raw)
  if (!user) return jsonError(401, 'unauthorized')
  if (user.role === 'applicant') return jsonError(403, 'forbidden')
  const application = getApplication(c.req.param('id'))
  if (!application) return jsonError(404, 'not_found')
  return c.json(await checklistFor(application.documentType))
})

app.post('/applications/:id/approver-review', async c => {
  const user = await getCurrentUser(c.req.raw)
  if (!user) return jsonError(401, 'unauthorized')
  if (user.role !== 'approver') return jsonError(403, 'forbidden')
  const application = getApplication(c.req.param('id'))
  if (!application) return jsonError(404, 'not_found')
  const body = approverReviewSchema.safeParse(
    await c.req.json().catch(() => null),
  )
  if (!body.success) return jsonError(400, 'invalid_fields')
  const answers = new Map(body.data.items.map(item => [item.id, item]))
  const checklist = await checklistFor(application.documentType)
  if (checklist.some(item => !answers.has(item.id))) {
    return jsonError(400, 'incomplete_checklist')
  }
  const result = submitApproverReview(application.id, user, {
    recommendation: body.data.recommendation,
    comment: body.data.comment,
    items: checklist.map(item => ({
      id: item.id,
      section: item.section,
      title: item.title,
      basis: item.basis,
      verdict: answers.get(item.id)!.verdict,
      comment: answers.get(item.id)!.comment,
    })),
  })
  if (result.error) {
    return jsonError(result.error === 'not_found' ? 404 : 409, result.error)
  }
  return c.json(forViewer(user, result.application))
})

app.post('/applications/:id/decision', async c => {
  const user = await getCurrentUser(c.req.raw)
  if (!user) return jsonError(401, 'unauthorized')
  if (user.role !== 'normcontrol') return jsonError(403, 'forbidden')
  const body = decisionSchema.safeParse(await c.req.json().catch(() => null))
  if (!body.success) return jsonError(400, 'invalid_fields')
  const result = decideApplication(c.req.param('id'), user, body.data)
  if (result.error) {
    return jsonError(result.error === 'not_found' ? 404 : 409, result.error)
  }
  return c.json(forViewer(user, result.application))
})

app.get('/applications/:id/file', async c => {
  const user = await getCurrentUser(c.req.raw)
  if (!user) return jsonError(401, 'unauthorized')
  const application = getApplication(c.req.param('id'))
  if (!application || !canAccess(user, application)) {
    return jsonError(404, 'not_found')
  }
  const index = Number(c.req.query('index') ?? 0)
  if (!Number.isInteger(index) || index < 0) return jsonError(400, 'invalid_fields')
  const file = readApplicationFile(c.req.param('id'), index)
  if (!file) return jsonError(404, 'not_found')
  return new Response(new Uint8Array(file.data), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(file.name)}`,
    },
  })
})

// Ассистент: только для вошедших; модель (GigaChat API) — в сервисе chat, ответ идёт потоком как есть.
app.post('/chat', async c => {
  const user = await getCurrentUser(c.req.raw)
  if (!user) return c.body(null, 401)
  const upstream = await fetch(`${CHAT_URL}/chat/assistant`, {
    method: 'POST',
    headers: { 'content-type': c.req.header('content-type') ?? 'application/json' },
    body: await c.req.raw.text(),
    signal: c.req.raw.signal,
  }).catch(() => null)
  if (!upstream) return jsonError(503, 'assistant_unavailable')
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      'content-type': upstream.headers.get('content-type') ?? 'text/event-stream',
      'cache-control': 'no-cache',
    },
  })
})

app.get('/dev/mailbox/:email', c => {
  if (PRODUCTION && process.env.PROTOTYPE_DEV_MAILBOX !== '1') return c.notFound()
  const message = readMailbox(c.req.param('email'))
  return message ? c.json(message) : c.json({ error: 'empty' }, 404)
})

// Схема better-auth (в том числе своё поле user.role) — как `auth migrate`, но при каждом старте:
// недостающие таблицы и столбцы создаются, существующие данные не трогаются.
const migrations = await getMigrations(auth.options)
if (migrations.toBeCreated.length || migrations.toBeAdded.length) {
  await migrations.runMigrations()
  console.log(
    `applications-api: схема better-auth обновлена — таблицы: ${migrations.toBeCreated.map(t => t.table).join(', ') || '—'}, ` +
      `столбцы: ${migrations.toBeAdded.flatMap(t => Object.keys(t.fields).map(f => `${t.table}.${f}`)).join(', ') || '—'}`,
  )
}

await seedDemoAccounts()

const port = Number(process.env.PORT ?? 3100)
for (const application of listApplications()) {
  if ((application.status === 'ai_check' || application.status === 'review') &&
      (!application.aiReview || application.aiReview.state === 'running')) {
    void runAiReview(application.id)
  }
}
serve({ fetch: app.fetch, port }, () => {
  console.log(`applications-api: http://0.0.0.0:${port}/new/api, chat ${CHAT_URL}`)
})
