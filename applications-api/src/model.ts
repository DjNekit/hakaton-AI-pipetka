// Типы и схемы заявки — те же, что у клиента (prototype/src/entities/application/model.ts, entities/auth/role.ts).
import { z } from 'zod'

export const ROLES = ['applicant', 'approver', 'normcontrol'] as const
export type Role = (typeof ROLES)[number]

export function toRole(value: unknown): Role {
  return value === 'approver' || value === 'normcontrol' ? value : 'applicant'
}

export const APPLICATION_STATUSES = [
  'ai_check',
  'review',
  'normcontrol',
  'approved',
  'rejected',
] as const
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number]

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
  aiReview: AiReview | null
  approverReview: ApproverReview | null
  decision: Decision | null
  createdAt: string
  updatedAt: string
}

export interface ReviewItem {
  id: string
  section: string
  title: string
  basis: string
  verdict: AiVerdict
  comment: string
}

export const RECOMMENDATIONS = ['approve', 'reject'] as const
export type Recommendation = (typeof RECOMMENDATIONS)[number]

export interface ApproverReview {
  reviewerId: string
  reviewerName: string
  items: ReviewItem[]
  recommendation: Recommendation
  comment: string
  submittedAt: string
}

export const DECISIONS = ['approved', 'rejected'] as const
export type DecisionValue = (typeof DECISIONS)[number]

export interface Decision {
  deciderId: string
  deciderName: string
  decision: DecisionValue
  comment: string
  decidedAt: string
}

export const approverReviewSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      verdict: z.enum(AI_VERDICTS),
      comment: z.string().max(1000),
    }),
  ),
  recommendation: z.enum(RECOMMENDATIONS),
  comment: z.string().max(2000),
})

export const decisionSchema = z
  .object({
    decision: z.enum(DECISIONS),
    comment: z.string().trim().max(2000),
  })
  .refine(value => value.decision === 'approved' || value.comment.length > 0, {
    path: ['comment'],
  })
