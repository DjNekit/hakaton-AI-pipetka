import { createFileRoute } from '@tanstack/react-router'

import { documentTypeSchema } from '@/entities/application'
import { runAiReview } from '@/server/ai-review'
import {
  createApplication,
  forViewer,
  listApplications,
} from '@/server/applications'
import { getCurrentUser, jsonError } from '@/server/current-user'

const MAX_FILE_SIZE = 50 * 1024 * 1024

function text(value: FormDataEntryValue | null) {
  return typeof value === 'string' ? value.trim() : ''
}

export const Route = createFileRoute('/api/applications/')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const user = await getCurrentUser(request)
        if (!user) return jsonError(401, 'unauthorized')
        return Response.json(
          listApplications(
            user.role === 'approver' ? {} : { applicantId: user.id },
          ).map(item => forViewer(user, item)),
        )
      },
      POST: async ({ request }) => {
        const user = await getCurrentUser(request)
        if (!user) return jsonError(401, 'unauthorized')
        if (user.role !== 'applicant') return jsonError(403, 'forbidden')
        const form = await request.formData()
        const documentType = documentTypeSchema.safeParse(
          form.get('documentType'),
        )
        const address = text(form.get('address'))
        const description = text(form.get('description'))
        const file = form.get('file')
        if (!documentType.success || !address) {
          return jsonError(400, 'invalid_fields')
        }
        if (!(file instanceof File) || file.type !== 'application/pdf') {
          return jsonError(400, 'invalid_file')
        }
        if (file.size > MAX_FILE_SIZE) return jsonError(400, 'file_too_large')
        const application = await createApplication(
          user,
          { documentType: documentType.data, address, description },
          file,
        )
        void runAiReview(application.id)
        return Response.json(forViewer(user, application), { status: 201 })
      },
    },
  },
})
