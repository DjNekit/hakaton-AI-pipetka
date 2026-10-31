import { createFileRoute } from '@tanstack/react-router'

import { reviewSchema } from '@/entities/application'
import {
  canAccess,
  forViewer,
  getApplication,
  updateApplication,
} from '@/server/applications'
import { getCurrentUser, jsonError } from '@/server/current-user'

export const Route = createFileRoute('/api/applications/$id/')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const user = await getCurrentUser(request)
        if (!user) return jsonError(401, 'unauthorized')
        const application = getApplication(params.id)
        if (!application || !canAccess(user, application)) {
          return jsonError(404, 'not_found')
        }
        return Response.json(forViewer(user, application))
      },
      PATCH: async ({ request, params }) => {
        const user = await getCurrentUser(request)
        if (!user) return jsonError(401, 'unauthorized')
        if (user.role !== 'approver') return jsonError(403, 'forbidden')
        const patch = reviewSchema
          .partial()
          .safeParse(await request.json().catch(() => null))
        if (!patch.success) return jsonError(400, 'invalid_fields')
        const application = updateApplication(params.id, patch.data)
        if (!application) return jsonError(404, 'not_found')
        return Response.json(application)
      },
    },
  },
})
