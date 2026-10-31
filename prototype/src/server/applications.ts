import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import Database from 'better-sqlite3'

import type {
  AiReview,
  Application,
  ApplicationStatus,
  DocumentType,
} from '@/entities/application/model'

import type { CurrentUser } from './current-user'

type Row = Omit<Application, 'aiReview'> & {
  filePath: string
  aiReview: string | null
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
  const columns = db
    .prepare<[], { name: string }>('pragma table_info(application)')
    .all()
  if (!columns.some(column => column.name === 'aiReview')) {
    db.exec('alter table application add column aiReview text')
  }
  return db
}

function toApplication({
  filePath: _filePath,
  aiReview,
  ...rest
}: Row): Application {
  return {
    ...rest,
    aiReview: aiReview ? (JSON.parse(aiReview) as AiReview) : null,
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
) {
  const id = randomUUID()
  mkdirSync(UPLOADS_DIR, { recursive: true })
  const filePath = path.join(UPLOADS_DIR, `${id}.pdf`)
  writeFileSync(filePath, Buffer.from(await file.arrayBuffer()))
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
  })
  insert()
  return getApplication(id)!
}

export function updateApplication(
  id: string,
  patch: { status?: ApplicationStatus; reviewComment?: string },
) {
  const row = findRow(id)
  if (!row) return undefined
  connection()
    .prepare(
      'update application set status = ?, reviewComment = ?, updatedAt = ? where id = ?',
    )
    .run(
      patch.status ?? row.status,
      patch.reviewComment ?? row.reviewComment,
      new Date().toISOString(),
      id,
    )
  return getApplication(id)
}

export function setAiReview(
  id: string,
  aiReview: AiReview,
  status?: ApplicationStatus,
) {
  const row = findRow(id)
  if (!row) return
  connection()
    .prepare(
      'update application set aiReview = ?, status = ?, updatedAt = ? where id = ?',
    )
    .run(
      JSON.stringify(aiReview),
      status ?? row.status,
      new Date().toISOString(),
      id,
    )
}

export function readApplicationFile(id: string) {
  const row = findRow(id)
  if (!row) return undefined
  return { name: row.fileName, data: readFileSync(row.filePath) }
}

export function forViewer(user: CurrentUser, application: Application) {
  return user.role === 'approver'
    ? application
    : { ...application, aiReview: null }
}

export function canAccess(user: CurrentUser, application: Application) {
  return user.role === 'approver' || application.applicantId === user.id
}
