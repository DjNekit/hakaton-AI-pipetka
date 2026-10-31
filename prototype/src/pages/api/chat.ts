import {
  chat,
  chatParamsFromRequest,
  toServerSentEventsResponse,
} from '@tanstack/ai'
import { createFileRoute } from '@tanstack/react-router'

import { textAdapter } from '@/server/ai'
import { auth } from '@/server/auth'

export const Route = createFileRoute('/api/chat')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const session = await auth.api.getSession({ headers: request.headers })
        if (!session) return new Response(null, { status: 401 })
        const { messages, threadId } = await chatParamsFromRequest(request)
        const abortController = new AbortController()
        request.signal.addEventListener('abort', () => abortController.abort())
        const stream = chat({
          adapter: textAdapter(),
          messages,
          threadId,
          abortController,
        })
        return toServerSentEventsResponse(stream, { abortController })
      },
    },
  },
})
