import { queryOptions } from '@tanstack/react-query'

import { requestJson } from '@/shared/api'
import { z } from '@/shared/i18n'

export const APPLICATION_STATUSES = [
  'ai_check',
  'in_review',
  'rework',
  'approved',
  'rejected',
] as const
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number]
export const applicationStatusSchema = z.enum(APPLICATION_STATUSES)

export const REVIEW_STATUSES = [
  'in_review',
  'rework',
  'approved',
  'rejected',
] as const satisfies readonly ApplicationStatus[]
export type ReviewStatus = (typeof REVIEW_STATUSES)[number]

export function isReviewStatus(
  status: ApplicationStatus,
): status is ReviewStatus {
  return (REVIEW_STATUSES as readonly ApplicationStatus[]).includes(status)
}

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
export type ReviewData = z.infer<typeof reviewSchema>

export function formatApplicationNumber(number: number) {
  return `ЗК-${number}`
}

export function applicationFileUrl(id: string) {
  return `/api/applications/${id}/file`
}

export const applicationKeys = {
  all: ['applications'] as const,
  detail: (id: string) => ['applications', id] as const,
}

const AI_POLL_INTERVAL = 3000

export function applicationsQueryOptions() {
  return queryOptions({
    queryKey: applicationKeys.all,
    queryFn: () => requestJson<Application[]>('/api/applications'),
    refetchInterval: query =>
      query.state.data?.some(item => item.status === 'ai_check')
        ? AI_POLL_INTERVAL
        : false,
  })
}

export function applicationQueryOptions(id: string) {
  return queryOptions({
    queryKey: applicationKeys.detail(id),
    queryFn: () => requestJson<Application>(`/api/applications/${id}`),
    refetchInterval: query =>
      query.state.data?.status === 'ai_check' ? AI_POLL_INTERVAL : false,
  })
}
