import { createFileRoute } from '@tanstack/react-router'

import {
  canAccess,
  getApplication,
  readApplicationFile,
} from '@/server/applications'
import { getCurrentUser, jsonError } from '@/server/current-user'

export const Route = createFileRoute('/api/applications/$id/file')({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const user = await getCurrentUser(request)
        if (!user) return jsonError(401, 'unauthorized')
        const application = getApplication(params.id)
        if (!application || !canAccess(user, application)) {
          return jsonError(404, 'not_found')
        }
        const file = readApplicationFile(params.id)
        if (!file) return jsonError(404, 'not_found')
        return new Response(new Uint8Array(file.data), {
          headers: {
            'content-type': 'application/pdf',
            'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(file.name)}`,
          },
        })
      },
    },
  },
})
