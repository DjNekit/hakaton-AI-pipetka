import { TanStackDevtools } from '@tanstack/react-devtools'
import { FormDevtoolsPanel } from '@tanstack/react-form-devtools'
import {
  HeadContent,
  Scripts,
  createRootRouteWithContext,
  Outlet,
  useRouter,
} from '@tanstack/react-router'
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools'
import { useEffect } from 'react'

import { NotFound, ConnectionError } from '@/pages/-root'
import { getSession } from '@/server/session'
import { I18nProvider } from '@/shared/i18n'
import { QueryClientProvider } from '@/shared/query'
import type { QueryClient } from '@/shared/query'
import TanStackQueryDevtools from '@/shared/query/devtools'
import { Toaster } from '@/shared/ui/components/sonner'
import { ThemeProvider } from '@/shared/ui/providers/theme-provider'

import appCss from '@/shared/ui/styles/globals.css?url'

interface MyRouterContext {
  queryClient: QueryClient
}

const THEME_INIT_SCRIPT = `(function(){try{var stored=window.localStorage.getItem('theme');var mode=(stored==='light'||stored==='dark'||stored==='system')?stored:'system';var prefersDark=window.matchMedia('(prefers-color-scheme: dark)').matches;var resolved=mode==='system'?(prefersDark?'dark':'light'):mode;var root=document.documentElement;root.classList.remove('light','dark');root.classList.add(resolved);root.style.colorScheme=resolved;}catch(e){}})();`

export const Route = createRootRouteWithContext<MyRouterContext>()({
  head: () => ({
    meta: [
      {
        charSet: 'utf-8',
      },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1',
      },
      {
        title: 'Колорпаспорт',
      },
    ],
    links: [
      {
        rel: 'stylesheet',
        href: appCss,
      },
    ],
  }),
  beforeLoad: async () => {
    const session = await getSession()
    return { session }
  },
  component: RootLayout,
  errorComponent: RootError,
  notFoundComponent: NotFound,
  shellComponent: RootDocument,
})

function RootLayout() {
  const context = Route.useRouteContext()

  useEffect(() => {
    document.documentElement.dataset.hydrated = 'true'
  }, [])

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

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <HeadContent />
      </head>
      <body className="font-sans break-words antialiased">
        {children}
        <Scripts />
      </body>
    </html>
  )
}
