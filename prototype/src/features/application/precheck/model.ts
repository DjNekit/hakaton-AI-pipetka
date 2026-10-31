import { useEffect } from 'react'

import { applicationKeys } from '@/entities/application'
import { apiUrl, requestJson } from '@/shared/api'
import { queryOptions, useQuery, useQueryClient } from '@/shared/query'

export interface PrecheckFinding {
  rule: string
  title: string
  ref: string
  severity: 'error' | 'warning'
  message: string
  page: number | null
  expected: string | null
  actual: string | null
}

export interface VersionCheck {
  state: string
  stage: string
  progress: number
  result: {
    checkId: string
    documentKind: 'passport' | 'signage'
    verdict: string
    findings: PrecheckFinding[]
  } | null
}

export interface PrecheckAdvice {
  text: string
  provider: string
  model: string
}

const POLL_INTERVAL = 2000

function base(applicationId: string, versionId: string) {
  return `/applications/${applicationId}/versions/${versionId}`
}

export function versionCheckQueryOptions(
  applicationId: string,
  versionId: string,
) {
  return queryOptions({
    queryKey: ['applications', applicationId, 'versions', versionId, 'check'],
    queryFn: () =>
      requestJson<VersionCheck>(
        apiUrl(`${base(applicationId, versionId)}/check`),
      ),
    refetchInterval: query =>
      query.state.data?.result || query.state.data?.state === 'error'
        ? false
        : POLL_INTERVAL,
    staleTime: 30000,
  })
}

export function useVersionCheck(applicationId: string, versionId: string) {
  const queryClient = useQueryClient()
  const query = useQuery(versionCheckQueryOptions(applicationId, versionId))
  const done = Boolean(query.data?.result)
  useEffect(() => {
    if (done) {
      void queryClient.invalidateQueries({
        queryKey: applicationKeys.detail(applicationId),
        exact: true,
      })
    }
  }, [done, applicationId, queryClient])
  return query
}

export function useVersionAdvice(
  applicationId: string,
  versionId: string,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ['applications', applicationId, 'versions', versionId, 'advice'],
    queryFn: () =>
      requestJson<PrecheckAdvice>(
        apiUrl(`${base(applicationId, versionId)}/advice`),
        { method: 'POST' },
      ),
    enabled,
    staleTime: Infinity,
    retry: false,
  })
}

export function checkOutcome(check: VersionCheck | undefined) {
  if (!check) return 'running' as const
  if (check.state === 'error') return 'failed' as const
  if (!check.result) return 'running' as const
  const errors = check.result.findings.filter(
    f => f.severity === 'error',
  ).length
  if (check.result.verdict === 'fail') return 'errors' as const
  if (check.result.verdict === 'warn' && !check.result.findings.length) return 'warnings' as const
  return check.result.findings.length === 0
    ? ('clean' as const)
    : errors
      ? ('errors' as const)
      : ('warnings' as const)
}
