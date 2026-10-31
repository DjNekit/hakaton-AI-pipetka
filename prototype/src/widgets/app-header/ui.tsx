import { useRef } from 'react'

import { Link, useRouter } from '@tanstack/react-router'

import { HttpError, apiUrl, requestJson } from '@/shared/api'
import { useQuery } from '@/shared/query'

import type { Role } from '@/entities/auth'
import { useSignOut } from '@/features/auth/sign-out'
import { useTranslation } from '@/shared/i18n'
import { Button } from '@/shared/ui/components/button'
import { SpinnerAddon } from '@/shared/ui/components/spinner-addon'

interface ConnectionStatus {
  available: boolean
  reachable?: boolean
  model: string | null
  message: string
  checkedAt?: string
}

function GigaChatStatus() {
  const forceRefresh = useRef(false)
  const status = useQuery({
    queryKey: ['gigachat-status'],
    queryFn: ({ signal }) => {
      const refresh = forceRefresh.current
      forceRefresh.current = false
      return requestJson<ConnectionStatus>(apiUrl(`/chat/health${refresh ? '?refresh=1' : ''}`), { signal })
    },
    refetchInterval: 30000,
    staleTime: 5000,
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
    retry: (count, error) => !(error instanceof HttpError && [401, 403, 404].includes(error.status)) && count < 2,
    retryDelay: attempt => Math.min(1000 * 2 ** attempt, 5000),
  })
  const checking = status.isPending || status.isFetching
  const loginRequired = status.error instanceof HttpError && [401, 403].includes(status.error.status)
  const unknown = status.isError || status.data?.reachable === false || !status.data
  const connected = !unknown && status.data?.available === true
  const label = checking ? 'Проверка связи' : loginRequired ? 'Нужен вход' : unknown ? 'Статус неизвестен' : connected ? 'Подключён' : 'Недоступен'
  const detail = loginRequired ? 'Сессия истекла. Войдите заново, чтобы проверить подключение.'
    : status.isError ? `Не удалось получить статус от приложения${status.error instanceof HttpError ? ` (HTTP ${status.error.status})` : ''}. Это не подтверждает недоступность GigaChat.`
    : status.data?.message ?? 'Проверяем подключение к GigaChat'
  const checkedAt = status.data?.checkedAt ?? (status.dataUpdatedAt ? new Date(status.dataUpdatedAt).toISOString() : undefined)
  const checked = checkedAt ? `Проверено: ${new Date(checkedAt).toLocaleTimeString('ru-RU')}` : ''
  return (
    <button type="button" aria-label={`GigaChat: ${label}. Проверить подключение`} disabled={status.isFetching}
      title={[detail, status.data?.model, checked, 'Нажмите для повторной проверки'].filter(Boolean).join(' · ')}
      onClick={() => { forceRefresh.current = true; void status.refetch() }}
      className="inline-flex shrink-0 items-center gap-1.5 rounded-full border bg-muted/30 px-2.5 py-1 text-xs whitespace-nowrap transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait">
      <span role="status" aria-live="polite" className="inline-flex items-center gap-1.5">
        <span aria-hidden="true" className={`size-1.5 rounded-full ${checking ? 'animate-pulse bg-amber-500' : unknown ? 'bg-amber-500' : connected ? 'bg-emerald-500' : 'bg-rose-500'}`} />
        <span className="font-medium">GigaChat</span>
        <span className="text-muted-foreground">· {label}</span>
      </span>
    </button>
  )
}

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
      <div className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-2 sm:gap-3">
        <GigaChatStatus />
        <a
          href="/"
          className="hidden text-sm whitespace-nowrap text-muted-foreground hover:text-foreground xl:inline"
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
