import { createRouter as createTanStackRouter } from '@tanstack/react-router'

import { createAppQueryClient } from '@/shared/query'

import { routeTree } from './routeTree.gen'

// Клиент — статика (SPA) на /new; серверная часть — сервис prototype-api (/new/api).
export function getRouter() {
  const queryClient = createAppQueryClient()

  return createTanStackRouter({
    routeTree,
    basepath: '/new',
    context: { queryClient },
    scrollRestoration: true,
    defaultPreload: 'intent',
    defaultPreloadStaleTime: 0,
  })
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
