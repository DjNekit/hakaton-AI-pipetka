import { Link, useRouter } from '@tanstack/react-router'

import type { Role } from '@/entities/auth'
import { useSignOut } from '@/features/auth/sign-out'
import { useTranslation } from '@/shared/i18n'
import { Button } from '@/shared/ui/components/button'
import { SpinnerAddon } from '@/shared/ui/components/spinner-addon'

export interface AppNavItem {
  to: string
  label: string
  exact?: boolean
}

export function AppHeader({
  role,
  email,
  nav,
}: {
  role: Role
  email: string
  nav: AppNavItem[]
}) {
  const { t } = useTranslation()
  const router = useRouter()
  const signOut = useSignOut()

  return (
    <header className="flex shrink-0 flex-wrap items-center gap-x-6 gap-y-1 border-b px-4 pt-2 sm:h-14 sm:flex-nowrap sm:px-6 sm:pt-0">
      <div className="flex shrink-0 items-baseline gap-2 whitespace-nowrap">
        <span className="font-semibold">{t('app.name')}</span>
        <span className="text-xs text-muted-foreground">
          {t(`roles.${role}`)}
        </span>
      </div>
      <nav className="order-last -mx-4 flex w-[calc(100%+2rem)] items-center gap-1 overflow-x-auto px-4 pb-2 sm:order-none sm:mx-0 sm:w-auto sm:min-w-0 sm:p-0">
        {nav.map(item => (
          <Link
            key={item.to}
            to={item.to}
            activeOptions={{ exact: item.exact, includeSearch: false }}
            className="shrink-0 rounded-md px-2.5 py-1.5 text-sm whitespace-nowrap text-muted-foreground hover:bg-muted hover:text-foreground data-[status=active]:bg-muted data-[status=active]:text-foreground"
          >
            {item.label}
          </Link>
        ))}
      </nav>
      <div className="ml-auto flex shrink-0 items-center gap-3">
        <a
          href="/"
          className="text-sm whitespace-nowrap text-muted-foreground hover:text-foreground"
          title="Прежний интерфейс проверки пакетов документов"
        >
          Старый интерфейс
        </a>
        <span className="hidden truncate text-sm text-muted-foreground md:inline">
          {email}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={signOut.isPending}
          aria-busy={signOut.isPending}
          onClick={() =>
            signOut.mutate(undefined, {
              onSuccess: () => router.navigate({ to: '/sign-in' }),
            })
          }
        >
          <SpinnerAddon enabled={signOut.isPending} />
          {t('auth.signedIn.signOutButton')}
        </Button>
      </div>
    </header>
  )
}
