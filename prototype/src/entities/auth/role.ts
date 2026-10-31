export const ROLES = ['applicant', 'approver'] as const

export type Role = (typeof ROLES)[number]

export function toRole(value: unknown): Role {
  return value === 'approver' ? 'approver' : 'applicant'
}

export const ROLE_HOME = {
  applicant: '/applicant',
  approver: '/approver',
} as const satisfies Record<Role, string>
