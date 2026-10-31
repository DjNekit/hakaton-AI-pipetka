export const ROLES = ['applicant', 'approver', 'normcontrol'] as const

export type Role = (typeof ROLES)[number]

export function toRole(value: unknown): Role {
  return value === 'approver' || value === 'normcontrol' ? value : 'applicant'
}

export const ROLE_HOME = {
  applicant: '/applicant',
  approver: '/approver',
  normcontrol: '/normcontrol',
} as const satisfies Record<Role, string>
