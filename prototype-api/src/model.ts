// Типы и схемы заявки — те же, что у клиента (prototype/src/entities/application/model.ts, entities/auth/role.ts).
import { z } from 'zod'

export const ROLES = ['applicant', 'approver'] as const
export type Role = (typeof ROLES)[number]

export function toRole(value: unknown): Role {
  return value === 'approver' ? 'approver' : 'applicant'
}

export const APPLICATION_STATUSES = [
  'ai_check',
  'in_review',
  'rework',
  'approved',
  'rejected',
] as const
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number]

export const REVIEW_STATUSES = [
  'in_review',
  'rework',
  'approved',
  'rejected',
] as const satisfies readonly ApplicationStatus[]

export const AI_VERDICTS = [
  'violation',
  'ok',
  'not_applicable',
  'unknown',
] as const
export type AiVerdict = (typeof AI_VERDICTS)[number]

export interface AiReviewItem {
  id: string
  section: string
  title: string
  basis: string
  verdict: AiVerdict
  result: string
  comment: string
}

export interface AiReview {
  state: 'running' | 'done' | 'failed'
  summary: string
  items: AiReviewItem[]
  error?: string
  model?: string
  finishedAt?: string
}

export const DOCUMENT_TYPES = ['passport', 'signage', 'facade'] as const
export type DocumentType = (typeof DOCUMENT_TYPES)[number]
export const documentTypeSchema = z.enum(DOCUMENT_TYPES)

export interface Application {
  id: string
  number: number
  applicantId: string
  applicantName: string
  applicantEmail: string
  documentType: DocumentType
  address: string
  description: string
  fileName: string
  status: ApplicationStatus
  reviewComment: string
  aiReview: AiReview | null
  createdAt: string
  updatedAt: string
}

export const reviewSchema = z.object({
  status: z.enum(REVIEW_STATUSES),
  reviewComment: z.string().max(2000),
})
