import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'

import { authSearchSchema, resolveRedirectPath } from '@/entities/auth'

export const Route = createFileRoute('/_auth')({
  validateSearch: authSearchSchema,
  beforeLoad: ({ context, search }) => {
    if (context.session) {
      throw redirect({ href: resolveRedirectPath(search.redirect) })
    }
  },
  component: RouteComponent,
})

function RouteComponent() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-6">
      <Outlet />
      <a href="/" className="text-sm text-muted-foreground hover:text-foreground">
        Старый интерфейс
      </a>
    </main>
  )
}
