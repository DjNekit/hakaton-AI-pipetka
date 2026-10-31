// Сервис applications-api: серверная логика нового интерфейса (клиент — prototype/, адрес /new).
//   /new/api/auth/*                     better-auth: регистрация, вход, коды, сброс пароля
//   GET/POST /new/api/applications      заявки (заявитель — свои, согласующий и нормоконтролёр — все)
//   GET /new/api/applications/:id       заявка (согласующему — без проверки ИИ, заявителю — только решение)
//   GET /new/api/applications/:id/checklist        пункты чек-листа для ручной проверки
//   POST /new/api/applications/:id/approver-review проверка согласующего (независимо от ИИ)
//   POST /new/api/applications/:id/decision        решение нормоконтролёра
//   GET /new/api/applications/:id/file  PDF заявки
//   POST /new/api/chat                  ассистент: поток AG-UI от сервиса chat (GigaChat API)
//   GET /new/api/dev/mailbox/:email     последнее «письмо» (коды, ссылки) — только вне продакшена
//   GET /new/api/health
import { serve } from '@hono/node-server'
import { getMigrations } from 'better-auth/db/migration'
import { Hono } from 'hono'

import { checklistFor, runAiReview } from './ai-review'
import {
  canAccess,
  createApplication,
  decideApplication,
  forViewer,
  getApplication,
  listApplications,
  readApplicationFile,
  submitApproverReview,
} from './applications'
import { auth } from './auth'
import { getCurrentUser, jsonError } from './current-user'
import { readMailbox } from './mailbox'
import {
  approverReviewSchema,
  decisionSchema,
  documentTypeSchema,
} from './model'

const MAX_FILE_SIZE = 50 * 1024 * 1024
const CHAT_URL = (process.env.CHAT_URL ?? 'http://chat:3000').replace(/\/+$/, '')
const PRODUCTION = process.env.NODE_ENV === 'production'

function text(value: FormDataEntryValue | null) {
  return typeof value === 'string' ? value.trim() : ''
}

const app = new Hono().basePath('/new/api')

app.get('/health', c => c.json({ ok: true }))

app.on(['GET', 'POST'], '/auth/*', c => auth.handler(c.req.raw))

app.get('/applications', async c => {
  const user = await getCurrentUser(c.req.raw)
  if (!user) return jsonError(401, 'unauthorized')
  return c.json(
    listApplications(user.role === 'applicant' ? { applicantId: user.id } : {}).map(
      item => forViewer(user, item),
    ),
  )
})

app.post('/applications', async c => {
  const user = await getCurrentUser(c.req.raw)
  if (!user) return jsonError(401, 'unauthorized')
  if (user.role !== 'applicant') return jsonError(403, 'forbidden')
  const form = await c.req.raw.formData()
  const documentType = documentTypeSchema.safeParse(form.get('documentType'))
  const address = text(form.get('address'))
  const description = text(form.get('description'))
  const file = form.get('file')
  if (!documentType.success || !address) return jsonError(400, 'invalid_fields')
  if (!(file instanceof File) || file.type !== 'application/pdf') {
    return jsonError(400, 'invalid_file')
  }
  if (file.size > MAX_FILE_SIZE) return jsonError(400, 'file_too_large')
  const application = await createApplication(
    user,
    { documentType: documentType.data, address, description },
    file,
  )
  void runAiReview(application.id)
  return c.json(forViewer(user, application), 201)
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

app.get('/applications/:id/checklist', async c => {
  const user = await getCurrentUser(c.req.raw)
  if (!user) return jsonError(401, 'unauthorized')
  if (user.role === 'applicant') return jsonError(403, 'forbidden')
  const application = getApplication(c.req.param('id'))
  if (!application) return jsonError(404, 'not_found')
  return c.json(checklistFor(application.documentType))
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
  const checklist = checklistFor(application.documentType)
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
  const file = readApplicationFile(c.req.param('id'))
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

const port = Number(process.env.PORT ?? 3100)
serve({ fetch: app.fetch, port }, () => {
  console.log(`applications-api: http://0.0.0.0:${port}/new/api, chat ${CHAT_URL}`)
})
