import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import Database from 'better-sqlite3'

import {
  APPLICATION_STATUSES,
  type AiReview,
  type Application,
  type ApproverReview,
  type Decision,
  type DocumentType,
  type ReviewItem,
} from './model'

import type { CurrentUser } from './current-user'

type Row = Omit<Application, 'aiReview' | 'approverReview' | 'decision'> & {
  filePath: string
  reviewComment: string
  aiReview: string | null
  approverReview: string | null
  decision: string | null
}

const UPLOADS_DIR = path.resolve(process.env.UPLOADS_DIR ?? './uploads')

let db: Database.Database | undefined

function connection() {
  if (db) return db
  db = new Database(process.env.AUTH_DB_PATH ?? './dev-auth.db')
  db.exec(`
    create table if not exists application (
      id text primary key,
      number integer not null unique,
      applicantId text not null,
      applicantName text not null,
      applicantEmail text not null,
      documentType text not null,
      address text not null,
      description text not null default '',
      fileName text not null,
      filePath text not null,
      status text not null,
      reviewComment text not null default '',
      createdAt text not null,
      updatedAt text not null
    )
  `)
  db.exec(`create table if not exists application_file (
    applicationId text not null, position integer not null,
    name text not null, path text not null,
    primary key (applicationId, position)
  )`)
  const columns = db
    .prepare<[], { name: string }>('pragma table_info(application)')
    .all()
  for (const column of ['aiReview', 'approverReview', 'decision']) {
    if (!columns.some(existing => existing.name === column)) {
      db.exec(`alter table application add column ${column} text`)
    }
  }
  const known = APPLICATION_STATUSES.map(status => `'${status}'`).join(', ')
  db.exec(
    `update application set status = 'review' where status not in (${known})`,
  )
  return db
}

function parse<T>(value: string | null) {
  return value ? (JSON.parse(value) as T) : null
}

function toApplication({
  filePath: _filePath,
  reviewComment: _reviewComment,
  aiReview,
  approverReview,
  decision,
  ...rest
}: Row): Application {
  return {
    ...rest,
    aiReview: parse<AiReview>(aiReview),
    approverReview: parse<ApproverReview>(approverReview),
    decision: parse<Decision>(decision),
    files: connection().prepare<[string], { name: string; index: number }>(
      'select name, position as "index" from application_file where applicationId = ? order by position',
    ).all(rest.id),
  }
}

export function listApplications(filter: { applicantId?: string } = {}) {
  const rows = filter.applicantId
    ? connection()
        .prepare<[string], Row>(
          'select * from application where applicantId = ? order by number desc',
        )
        .all(filter.applicantId)
    : connection()
        .prepare<[], Row>('select * from application order by number desc')
        .all()
  return rows.map(toApplication)
}

function findRow(id: string) {
  return connection()
    .prepare<[string], Row>('select * from application where id = ?')
    .get(id)
}

export function getApplication(id: string) {
  const row = findRow(id)
  return row ? toApplication(row) : undefined
}

export async function createApplication(
  user: CurrentUser,
  input: { documentType: DocumentType; address: string; description: string },
  file: File,
  attachments: File[] = [],
) {
  const id = randomUUID()
  mkdirSync(UPLOADS_DIR, { recursive: true })
  const filePath = path.join(UPLOADS_DIR, `${id}.pdf`)
  writeFileSync(filePath, Buffer.from(await file.arrayBuffer()))
  const additionalFiles = []
  for (const [index, attachment] of attachments.entries()) {
    const target = path.join(UPLOADS_DIR, `${id}-${index + 1}.pdf`)
    writeFileSync(target, Buffer.from(await attachment.arrayBuffer()))
    additionalFiles.push({ name: attachment.name, path: target })
  }
  const now = new Date().toISOString()
  const insert = connection().transaction(() => {
    const { next } = connection()
      .prepare<[], { next: number }>(
        'select coalesce(max(number), 0) + 1 as next from application',
      )
      .get()!
    connection()
      .prepare(
        `insert into application (id, number, applicantId, applicantName, applicantEmail, documentType, address, description, fileName, filePath, status, reviewComment, createdAt, updatedAt)
         values (@id, @number, @applicantId, @applicantName, @applicantEmail, @documentType, @address, @description, @fileName, @filePath, 'ai_check', '', @now, @now)`,
      )
      .run({
        id,
        number: next,
        applicantId: user.id,
        applicantName: user.name,
        applicantEmail: user.email,
        ...input,
        fileName: file.name,
        filePath,
        now,
      })
    const saveFile = connection().prepare(
      'insert into application_file (applicationId, position, name, path) values (?, ?, ?, ?)',
    )
    for (const [index, entry] of [{ name: file.name, path: filePath }, ...additionalFiles].entries()) {
      saveFile.run(id, index, entry.name, entry.path)
    }
  })
  insert()
  return getApplication(id)!
}

function touch(id: string, fields: Record<string, string>) {
  const columns = Object.keys(fields)
    .map(column => `${column} = @${column}`)
    .join(', ')
  connection()
    .prepare(`update application set ${columns}, updatedAt = @now where id = @id`)
    .run({ ...fields, now: new Date().toISOString(), id })
}

export function setAiReview(id: string, aiReview: AiReview) {
  const row = findRow(id)
  if (!row) return
  const finished = aiReview.state === 'done' || aiReview.state === 'failed'
  touch(id, {
    aiReview: JSON.stringify(aiReview),
    status: finished && row.status === 'ai_check' ? 'review' : row.status,
  })
}

export function submitApproverReview(
  id: string,
  reviewer: CurrentUser,
  input: Pick<ApproverReview, 'recommendation' | 'comment'> & {
    items: ReviewItem[]
  },
) {
  const application = getApplication(id)
  if (!application) return { error: 'not_found' as const }
  if (application.status !== 'review' || application.approverReview) {
    return { error: 'invalid_state' as const }
  }
  const review: ApproverReview = {
    reviewerId: reviewer.id,
    reviewerName: reviewer.name,
    ...input,
    submittedAt: new Date().toISOString(),
  }
  touch(id, {
    approverReview: JSON.stringify(review),
    status: 'normcontrol',
  })
  return { application: getApplication(id)! }
}

export function decideApplication(
  id: string,
  decider: CurrentUser,
  input: Pick<Decision, 'decision' | 'comment'>,
) {
  const application = getApplication(id)
  if (!application) return { error: 'not_found' as const }
  if (application.status !== 'normcontrol') {
    return { error: 'invalid_state' as const }
  }
  const decision: Decision = {
    deciderId: decider.id,
    deciderName: decider.name,
    ...input,
    decidedAt: new Date().toISOString(),
  }
  touch(id, { decision: JSON.stringify(decision), status: input.decision })
  return { application: getApplication(id)! }
}

export function readApplicationFile(id: string, index = 0) {
  const row = findRow(id)
  if (!row) return undefined
  const entry = connection().prepare<[string, number], { name: string; path: string }>(
    'select name, path from application_file where applicationId = ? and position = ?',
  ).get(id, index)
  if (entry) return { name: entry.name, data: readFileSync(entry.path) }
  if (index !== 0) return undefined
  return { name: row.fileName, data: readFileSync(row.filePath) }
}

export function readApplicationFiles(id: string) {
  const rows = connection().prepare<[string], { name: string; path: string }>(
    'select name, path from application_file where applicationId = ? order by position',
  ).all(id)
  if (!rows.length) {
    const first = readApplicationFile(id)
    return first ? [first] : []
  }
  return rows.map(row => ({ name: row.name, data: readFileSync(row.path) }))
}

export function forViewer(
  user: CurrentUser,
  application: Application,
): Application {
  if (user.role === 'normcontrol') return application
  if (user.role === 'approver') return { ...application, aiReview: null }
  return { ...application, aiReview: null, approverReview: null }
}

export function canAccess(user: CurrentUser, application: Application) {
  return user.role !== 'applicant' || application.applicantId === user.id
}
