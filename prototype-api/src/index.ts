// Сервис prototype-api: серверная логика нового интерфейса (клиент — prototype/, адрес /new).
//   /new/api/auth/*                     better-auth: регистрация, вход, коды, сброс пароля
//   GET/POST /new/api/applications      заявки (заявитель — свои, согласующий — все)
//   GET/PATCH /new/api/applications/:id заявка; решение согласующего
//   GET /new/api/applications/:id/file  PDF заявки
//   POST /new/api/chat                  ассистент: поток AG-UI от сервиса chat (GigaChat API)
//   GET /new/api/dev/mailbox/:email     последнее «письмо» (коды, ссылки) — только вне продакшена
//   GET /new/api/health
import { serve } from '@hono/node-server'
import { Hono } from 'hono'

import { runAiReview } from './ai-review'
import {
  canAccess,
  createApplication,
  forViewer,
  getApplication,
  listApplications,
  readApplicationFile,
  updateApplication,
} from './applications'
import { auth } from './auth'
import { getCurrentUser, jsonError } from './current-user'
import { readMailbox } from './mailbox'
import { documentTypeSchema, reviewSchema } from './model'

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
    listApplications(user.role === 'approver' ? {} : { applicantId: user.id }).map(
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

app.patch('/applications/:id', async c => {
  const user = await getCurrentUser(c.req.raw)
  if (!user) return jsonError(401, 'unauthorized')
  if (user.role !== 'approver') return jsonError(403, 'forbidden')
  const patch = reviewSchema
    .partial()
    .safeParse(await c.req.json().catch(() => null))
  if (!patch.success) return jsonError(400, 'invalid_fields')
  const application = updateApplication(c.req.param('id'), patch.data)
  if (!application) return jsonError(404, 'not_found')
  return c.json(application)
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

const port = Number(process.env.PORT ?? 3100)
serve({ fetch: app.fetch, port }, () => {
  console.log(`prototype-api: http://0.0.0.0:${port}/new/api, chat ${CHAT_URL}`)
})
