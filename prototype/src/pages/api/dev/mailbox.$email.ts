import { createFileRoute } from '@tanstack/react-router'

import { readMailbox } from '@/server/mailbox'

export const Route = createFileRoute('/api/dev/mailbox/$email')({
  server: {
    handlers: {
      GET: ({ params }) => {
        if (!import.meta.env.DEV && process.env.AUTH_DB_PATH !== ':memory:') {
          return new Response('Not Found', { status: 404 })
        }
        const message = readMailbox(params.email)
        return message
          ? Response.json(message)
          : Response.json({ error: 'empty' }, { status: 404 })
      },
    },
  },
})
