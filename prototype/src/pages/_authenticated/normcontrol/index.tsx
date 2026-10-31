import { createFileRoute } from '@tanstack/react-router'

import {
  ApplicationsWorkspace,
  workspaceSearchSchema,
} from '@/pages/-workspace'

export const Route = createFileRoute('/_authenticated/normcontrol/')({
  validateSearch: workspaceSearchSchema,
  component: Workspace,
})

function Workspace() {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  return (
    <ApplicationsWorkspace
      role="normcontrol"
      search={search}
      onSearchChange={patch =>
        void navigate({ search: prev => ({ ...prev, ...patch }) })
      }
    />
  )
}
