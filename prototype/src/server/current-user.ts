import { toRole, type Role } from '@/entities/auth/role'

import { auth } from './auth'

export interface CurrentUser {
  id: string
  name: string
  email: string
  role: Role
}

export async function getCurrentUser(
  request: Request,
): Promise<CurrentUser | null> {
  const session = await auth.api.getSession({ headers: request.headers })
  if (!session) return null
  const { id, name, email, role } = session.user
  return { id, name, email, role: toRole(role) }
}

export function jsonError(status: number, error: string) {
  return Response.json({ error }, { status })
}
