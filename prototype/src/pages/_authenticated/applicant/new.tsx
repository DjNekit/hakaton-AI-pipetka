import { createFileRoute } from '@tanstack/react-router'

import { DraftEditor } from '@/widgets/application-draft'

export const Route = createFileRoute('/_authenticated/applicant/new')({
  component: NewApplication,
})

function NewApplication() {
  const navigate = Route.useNavigate()
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
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
