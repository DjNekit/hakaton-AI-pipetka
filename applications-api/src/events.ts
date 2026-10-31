import type { CurrentUser } from './current-user'
import type { Application } from './model'

type Change = Pick<Application, 'id' | 'applicantId' | 'status'>
const listeners = new Set<(change: Change) => void>()

export function publishApplication(change: Change) {
  for (const listener of listeners) listener(change)
}

export function subscribeApplications(
  user: CurrentUser,
  listener: (id: string) => void,
) {
  const filtered = (change: Change) => {
    if (user.role === 'applicant' ? change.applicantId === user.id : change.status !== 'draft') {
      listener(change.id)
    }
  }
  listeners.add(filtered)
  return () => { listeners.delete(filtered) }
}
