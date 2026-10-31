import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'

import { ROLE_HOME } from '@/entities/auth'
import { useTranslation } from '@/shared/i18n'
import { AppHeader } from '@/widgets/app-header'

export const Route = createFileRoute('/_authenticated/normcontrol')({
  beforeLoad: ({ context }) => {
    if (context.role !== 'normcontrol') {
      throw redirect({ to: ROLE_HOME[context.role] })
    }
  },
  component: Layout,
})

function Layout() {
  const { t } = useTranslation()
  const { user, role } = Route.useRouteContext()
  const nav = [{ to: '/normcontrol', label: t('nav.normcontrol'), exact: true }]

  return (
    <div className="flex h-svh flex-col">
      <AppHeader role={role} email={user.email} nav={nav} />
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <Outlet />
      </div>
    </div>
  )
}
