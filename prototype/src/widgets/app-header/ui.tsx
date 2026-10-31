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
    <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b px-6">
      <div className="flex items-center gap-6">
        <div className="flex items-baseline gap-2">
          <span className="font-semibold">{t('app.name')}</span>
          <span className="text-xs text-muted-foreground">
            {t(`roles.${role}`)}
          </span>
        </div>
        <nav className="flex items-center gap-1">
          {nav.map(item => (
            <Link
              key={item.to}
              to={item.to}
              activeOptions={{ exact: item.exact }}
              className="rounded-md px-2.5 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground data-[status=active]:bg-muted data-[status=active]:text-foreground"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </div>
      <div className="flex items-center gap-3">
        <span className="hidden text-sm text-muted-foreground sm:inline">
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
