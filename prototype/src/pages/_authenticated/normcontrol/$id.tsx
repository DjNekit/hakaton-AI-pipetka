import { createFileRoute } from '@tanstack/react-router'

import { StaffApplicationPage } from '@/pages/-workspace'

export const Route = createFileRoute('/_authenticated/normcontrol/$id')({
  component: ApplicationPage,
})

function ApplicationPage() {
  const { id } = Route.useParams()
  return <StaffApplicationPage id={id} role="normcontrol" />
}
