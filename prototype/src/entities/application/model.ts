import { queryOptions } from '@tanstack/react-query'

import { apiUrl, requestJson } from '@/shared/api'
import { z } from '@/shared/i18n'

export const APPLICATION_STATUSES = [
  'review',
  'normcontrol',
  'approved',
  'rejected',
] as const
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number]

export const VERDICTS = [
  'violation',
  'ok',
  'not_applicable',
  'unknown',
] as const
export type Verdict = (typeof VERDICTS)[number]
export type AiVerdict = Verdict

export interface AiReviewItem {
  id: string
  section: string
  title: string
  basis: string
  verdict: Verdict
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

export interface ReviewItem {
  id: string
  section: string
  title: string
  basis: string
  verdict: Verdict
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

export interface ChecklistItem {
  id: string
  section: string
  title: string
  check: string
  basis: string
  options: string[]
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

export function formatApplicationNumber(number: number) {
  return `ЗК-${number}`
}

export function applicationFileUrl(id: string) {
  return apiUrl(`/applications/${id}/file`)
}

export const applicationKeys = {
  all: ['applications'] as const,
  detail: (id: string) => ['applications', id] as const,
  checklist: (id: string) => ['applications', id, 'checklist'] as const,
}

const POLL_INTERVAL = 4000

export function applicationsQueryOptions() {
  return queryOptions({
    queryKey: applicationKeys.all,
    queryFn: () => requestJson<Application[]>(apiUrl('/applications')),
    refetchInterval: query =>
      query.state.data?.some(item => item.status === 'review')
        ? POLL_INTERVAL
        : false,
  })
}

export function applicationQueryOptions(id: string) {
  return queryOptions({
    queryKey: applicationKeys.detail(id),
    queryFn: () => requestJson<Application>(apiUrl(`/applications/${id}`)),
    refetchInterval: query =>
      query.state.data?.status === 'review' ? POLL_INTERVAL : false,
  })
}

export function checklistQueryOptions(id: string) {
  return queryOptions({
    queryKey: applicationKeys.checklist(id),
    queryFn: () =>
      requestJson<ChecklistItem[]>(apiUrl(`/applications/${id}/checklist`)),
    staleTime: Infinity,
  })
}
