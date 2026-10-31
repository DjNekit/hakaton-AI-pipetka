import { createFileRoute } from '@tanstack/react-router'

import { DraftEditor } from '@/widgets/application-draft'

export const Route = createFileRoute('/_authenticated/applicant/new')({
  component: NewApplication,
})

function NewApplication() {
  const navigate = Route.useNavigate()
  return (
    <main className="flex min-h-0 w-full flex-1 flex-col overflow-hidden p-3 sm:p-4">
      <DraftEditor
        onCreated={application =>
          void navigate({
            to: '/applicant/$id',
            params: { id: application.id },
            replace: true,
          })
        }
        onSubmitted={() => undefined}
      />
    </main>
  )
}
