import { createFileRoute, redirect } from '@tanstack/react-router'

import { ROLE_HOME } from '@/entities/auth'

export const Route = createFileRoute('/_authenticated/')({
  beforeLoad: ({ context }) => {
    throw redirect({ to: ROLE_HOME[context.role] })
  },
})
