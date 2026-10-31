import { TanStackDevtools } from '@tanstack/react-devtools'
import { FormDevtoolsPanel } from '@tanstack/react-form-devtools'
import {
  createRootRouteWithContext,
  Outlet,
  useRouter,
} from '@tanstack/react-router'
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools'
import { useEffect } from 'react'

import { NotFound, ConnectionError } from '@/pages/-root'
import { authClient } from '@/shared/auth-client'
import { apiUrl } from '@/shared/api'
import { I18nProvider } from '@/shared/i18n'
import { QueryClientProvider } from '@/shared/query'
import type { QueryClient } from '@/shared/query'
import TanStackQueryDevtools from '@/shared/query/devtools'
import { Toaster } from '@/shared/ui/components/sonner'
import { ThemeProvider } from '@/shared/ui/providers/theme-provider'

interface MyRouterContext {
  queryClient: QueryClient
}

export const Route = createRootRouteWithContext<MyRouterContext>()({
  // Сессия — запросом к applications-api (better-auth); перед каждым переходом, как раньше на сервере.
  beforeLoad: async () => {
    const { data } = await authClient.getSession()
    return { session: data }
  },
  component: RootLayout,
  errorComponent: RootError,
  notFoundComponent: NotFound,
})

function RootLayout() {
  const context = Route.useRouteContext()
  const router = useRouter()

  useEffect(() => {
    document.documentElement.dataset.hydrated = 'true'
  }, [])

  const userId = context.session?.user.id
  useEffect(() => {
    if (!userId) return
    const events = new EventSource(apiUrl('/events'))
    const refresh = () => {
      void context.queryClient.invalidateQueries({ queryKey: ['applications'] })
    }
    events.addEventListener('ready', refresh)
    events.addEventListener('application', refresh)
    events.addEventListener('session-ended', () => {
      events.close()
      context.queryClient.clear()
      void router.invalidate()
    })
    return () => events.close()
  }, [userId, context.queryClient, router])

  return (
    <ThemeProvider>
      <I18nProvider>
        <QueryClientProvider client={context.queryClient}>
          <Outlet />
          <Toaster position="top-center" richColors />
          <TanStackDevtools
            config={{
              position: 'bottom-right',
            }}
            plugins={[
              {
                name: 'Tanstack Router',
                render: <TanStackRouterDevtoolsPanel />,
              },
              {
                name: 'Form',
                render: <FormDevtoolsPanel />,
              },
              TanStackQueryDevtools,
            ]}
          />
        </QueryClientProvider>
      </I18nProvider>
    </ThemeProvider>
  )
}

function RootError() {
  const router = useRouter()
  return <ConnectionError onRetry={() => void router.invalidate()} />
}
