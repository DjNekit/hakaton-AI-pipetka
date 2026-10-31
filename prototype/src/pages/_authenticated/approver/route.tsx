import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'

import { ROLE_HOME } from '@/entities/auth'
import { useTranslation } from '@/shared/i18n'
import { AppHeader } from '@/widgets/app-header'

export const Route = createFileRoute('/_authenticated/approver')({
  beforeLoad: ({ context }) => {
    if (context.role !== 'approver') {
      throw redirect({ to: ROLE_HOME[context.role] })
    }
  },
  component: Layout,
})

function Layout() {
  const { t } = useTranslation()
  const { user, role } = Route.useRouteContext()
  const nav = [{ to: '/approver', label: t('nav.board'), exact: true }]

  return (
    <div className="flex h-svh flex-col">
      <AppHeader role={role} email={user.email} nav={nav} />
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <Outlet />
      </div>
    </div>
  )
}
