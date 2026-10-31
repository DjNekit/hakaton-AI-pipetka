import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'

import { toRole } from '@/entities/auth'

export const Route = createFileRoute('/_authenticated')({
  beforeLoad: ({ context, location }) => {
    if (!context.session) {
      throw redirect({ to: '/sign-in', search: { redirect: location.href } })
    }
    return {
      user: context.session.user,
      role: toRole(context.session.user.role),
    }
  },
  component: () => <Outlet />,
})
