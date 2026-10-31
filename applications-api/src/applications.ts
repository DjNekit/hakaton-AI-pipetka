import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import Database from 'better-sqlite3'

import {
  APPLICATION_STATUSES,
  type AiReview,
  type Application,
  type ApplicationVersion,
  type ApproverReview,
  type Decision,
  type DocumentType,
  type ReviewItem,
  type VersionSummary,
} from './model'

import type { CurrentUser } from './current-user'

type Row = Omit<
  Application,
  'aiReview' | 'approverReview' | 'decision' | 'versions'
> & {
  filePath: string
  reviewComment: string
  aiReview: string | null
  approverReview: string | null
  decision: string | null
}

interface VersionRow {
  id: string
  applicationId: string
  version: number
  fileName: string
  filePath: string
  packageId: string
  summary: string | null
  createdAt: string
}

export interface DraftFields {
  documentType: DocumentType
  address: string
  description: string
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
  db.exec(`create table if not exists application_version_file (
    versionId text not null, position integer not null,
    name text not null, path text not null,
    primary key (versionId, position)
  )`)
  const columns = db
    .prepare<[], { name: string }>('pragma table_info(application)')
    .all()
  for (const column of [
    'aiReview',
    'approverReview',
    'decision',
    'submittedVersionId',
  ]) {
    if (!columns.some(existing => existing.name === column)) {
      db.exec(`alter table application add column ${column} text`)
    }
  }
  db.exec(`
    create table if not exists application_version (
      id text primary key,
      applicationId text not null,
      version integer not null,
      fileName text not null,
      filePath text not null,
      packageId text not null default '',
      summary text,
      createdAt text not null
    )
  `)
  db.exec(`
    insert into application_version (id, applicationId, version, fileName, filePath, packageId, createdAt)
    select lower(hex(randomblob(16))), id, 1, fileName, filePath, '', createdAt from application
    where not exists (select 1 from application_version v where v.applicationId = application.id)
  `)
  db.exec(`
    update application set submittedVersionId = (
      select v.id from application_version v where v.applicationId = application.id order by v.version desc limit 1
    ) where submittedVersionId is null and status != 'draft'
  `)
  db.exec(`insert or ignore into application_version_file (versionId, position, name, path)
    select v.id, f.position, f.name, f.path from application_version v
    join application_file f on f.applicationId = v.applicationId
    where v.id = (select id from application_version where applicationId = v.applicationId order by version desc limit 1)
      and not exists (select 1 from application_version_file vf where vf.versionId = v.id)`)
  db.exec(`insert or ignore into application_version_file (versionId, position, name, path)
    select id, 0, fileName, filePath from application_version`)
  const known = APPLICATION_STATUSES.map(status => `'${status}'`).join(', ')
  db.exec(
    `update application set status = 'review' where status not in (${known})`,
  )
  return db
}

function parse<T>(value: string | null) {
  return value ? (JSON.parse(value) as T) : null
}

function toVersion(row: VersionRow): ApplicationVersion {
  return {
    id: row.id,
    version: row.version,
    fileName: row.fileName,
    createdAt: row.createdAt,
    checked: Boolean(row.packageId),
    summary: parse<VersionSummary>(row.summary),
  }
}

function versionRows(applicationId: string) {
  return connection()
    .prepare<[string], VersionRow>(
      'select * from application_version where applicationId = ? order by version desc',
    )
    .all(applicationId)
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
    versions: versionRows(rest.id).map(toVersion),
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
        .prepare<[], Row>(
          "select * from application where status != 'draft' order by number desc",
        )
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

async function storeFile(id: string, file: File) {
  mkdirSync(UPLOADS_DIR, { recursive: true })
  const filePath = path.join(UPLOADS_DIR, `${id}.pdf`)
  writeFileSync(filePath, Buffer.from(await file.arrayBuffer()))
  return filePath
}

function insertVersion(
  applicationId: string,
  file: { name: string; path: string },
  packageId: string,
  attachments: Array<{ name: string; path: string }> = [],
) {
  const id = randomUUID()
  const { next } = connection()
    .prepare<[string], { next: number }>(
      'select coalesce(max(version), 0) + 1 as next from application_version where applicationId = ?',
    )
    .get(applicationId)!
  connection()
    .prepare(
      `insert into application_version (id, applicationId, version, fileName, filePath, packageId, createdAt)
       values (@id, @applicationId, @version, @fileName, @filePath, @packageId, @createdAt)`,
    )
    .run({
      id,
      applicationId,
      version: next,
      fileName: file.name,
      filePath: file.path,
      packageId,
      createdAt: new Date().toISOString(),
    })
  const save = connection().prepare(
    'insert into application_version_file (versionId, position, name, path) values (?, ?, ?, ?)',
  )
  for (const [index, entry] of [file, ...attachments].entries()) {
    save.run(id, index, entry.name, entry.path)
  }
  selectVersionFiles(applicationId, id)
  return id
}

function selectVersionFiles(applicationId: string, versionId: string) {
  connection().prepare('delete from application_file where applicationId = ?').run(applicationId)
  connection().prepare(`insert into application_file (applicationId, position, name, path)
    select ?, position, name, path from application_version_file where versionId = ?`).run(applicationId, versionId)
}

async function storeAttachments(files: File[]) {
  return Promise.all(files.map(async file => ({
    name: file.name, path: await storeFile(randomUUID(), file),
  })))
}

export async function createDraft(
  user: CurrentUser,
  input: DraftFields,
  file: File,
  packageId: string,
  attachments: File[] = [],
) {
  const id = randomUUID()
  const filePath = await storeFile(randomUUID(), file)
  const additionalFiles = await storeAttachments(attachments)
  const now = new Date().toISOString()
  connection().transaction(() => {
    const { next } = connection()
      .prepare<[], { next: number }>(
        'select coalesce(max(number), 0) + 1 as next from application',
      )
      .get()!
    connection()
      .prepare(
        `insert into application (id, number, applicantId, applicantName, applicantEmail, documentType, address, description, fileName, filePath, status, reviewComment, createdAt, updatedAt)
         values (@id, @number, @applicantId, @applicantName, @applicantEmail, @documentType, @address, @description, @fileName, @filePath, 'draft', '', @now, @now)`,
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
    insertVersion(id, { name: file.name, path: filePath }, packageId, additionalFiles)
  })()
  return getApplication(id)!
}

export async function addVersion(
  id: string,
  input: DraftFields,
  file: File,
  packageId: string,
  attachments: File[] = [],
) {
  const filePath = await storeFile(randomUUID(), file)
  const additionalFiles = await storeAttachments(attachments)
  connection().transaction(() => {
    insertVersion(id, { name: file.name, path: filePath }, packageId, additionalFiles)
    touch(id, { ...input, fileName: file.name, filePath })
  })()
  return getApplication(id)!
}

export function findVersion(applicationId: string, versionId: string) {
  const row = connection()
    .prepare<[string], VersionRow>('select * from application_version where id = ?')
    .get(versionId)
  return row && row.applicationId === applicationId ? row : undefined
}

export function setVersionSummary(versionId: string, summary: VersionSummary) {
  connection()
    .prepare('update application_version set summary = ? where id = ?')
    .run(JSON.stringify(summary), versionId)
}

export function readVersionFile(applicationId: string, versionId: string) {
  const row = findVersion(applicationId, versionId)
  return row ? { name: row.fileName, data: readFileSync(row.filePath) } : undefined
}

export function submitDraft(id: string, versionId: string, input: DraftFields) {
  const application = getApplication(id)
  if (!application) return { error: 'not_found' as const }
  if (application.status !== 'draft') return { error: 'invalid_state' as const }
  const version = findVersion(id, versionId)
  if (!version) return { error: 'not_found' as const }
  connection().transaction(() => {
    selectVersionFiles(id, version.id)
    touch(id, {
      ...input,
      fileName: version.fileName,
      filePath: version.filePath,
      submittedVersionId: version.id,
      status: 'ai_check',
    })
  })()
  return { application: getApplication(id)! }
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
  if (user.role === 'approver') {
    return {
      ...application,
      aiReview: null,
      versions: application.versions.map(version => ({
        ...version,
        summary: null,
      })),
    }
  }
  return { ...application, aiReview: null, approverReview: null }
}

export function canAccess(user: CurrentUser, application: Application) {
  if (user.role === 'applicant') return application.applicantId === user.id
  return application.status !== 'draft'
}
