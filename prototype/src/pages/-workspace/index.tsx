import { IconArrowLeft, IconLayoutKanban, IconList } from '@tabler/icons-react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import type { CSSProperties } from 'react'

import { applicationsQueryOptions } from '@/entities/application'
import { useTranslation, z } from '@/shared/i18n'
import { SidebarInset, SidebarProvider } from '@/shared/ui/components/sidebar'
import { Skeleton } from '@/shared/ui/components/skeleton'
import {
  ToggleGroup,
  ToggleGroupItem,
} from '@/shared/ui/components/toggle-group'
import {
  ApplicationReview,
  ApplicationSidebar,
  type StaffRole,
} from '@/widgets/application-details'
import { ApplicationsBoard } from '@/widgets/applications-board'
import { ApplicationsTable } from '@/widgets/applications-table'

export const workspaceSearchSchema = z.object({
  view: z.enum(['board', 'table']).optional().catch(undefined),
  selected: z.string().optional().catch(undefined),
})

export type WorkspaceSearch = z.infer<typeof workspaceSearchSchema>

export function ApplicationsWorkspace({
  role,
  search,
  onSearchChange,
}: {
  role: StaffRole
  search: WorkspaceSearch
  onSearchChange: (patch: Partial<WorkspaceSearch>) => void
}) {
  const { t } = useTranslation()
  const { data, isPending, isError } = useQuery(applicationsQueryOptions())
  const view = search.view ?? 'board'
  const panelId = view === 'board' ? search.selected : undefined
  const closePanel = () => onSearchChange({ selected: undefined })

  return (
    <SidebarProvider
      open={Boolean(panelId)}
      onOpenChange={open => {
        if (!open) closePanel()
      }}
      className="min-h-0 flex-1"
      style={{ '--sidebar-width': '30rem' } as CSSProperties}
    >
      <SidebarInset className="min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3 sm:px-6">
          <h1 className="text-lg font-semibold">{t('approver.board.title')}</h1>
          <ToggleGroup
            value={[view]}
            onValueChange={value => {
              const next = value[0]
              if (next === 'board' || next === 'table') {
                onSearchChange({ view: next })
              }
            }}
            variant="outline"
            size="sm"
          >
            <ToggleGroupItem value="board">
              <IconLayoutKanban />
              {t('approver.board.viewBoard')}
            </ToggleGroupItem>
            <ToggleGroupItem value="table">
              <IconList />
              {t('approver.board.viewTable')}
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
        {isPending && (
          <div className="flex gap-3 px-4 py-4 sm:px-6">
            <Skeleton className="h-64 w-72" />
            <Skeleton className="h-64 w-72" />
            <Skeleton className="h-64 w-72" />
          </div>
        )}
        {isError && (
          <p className="px-4 py-4 text-destructive sm:px-6">
            {t('application.loadError')}
          </p>
        )}
        {data && view === 'board' && (
          <ApplicationsBoard
            applications={data}
            role={role}
            selectedId={panelId}
          />
        )}
        {data && view === 'table' && (
          <ApplicationsTable
            applications={data}
            detailRoute={
              role === 'normcontrol' ? '/normcontrol/$id' : '/approver/$id'
            }
            showApplicant
          />
        )}
      </SidebarInset>
      <ApplicationSidebar id={panelId} role={role} onClose={closePanel} />
    </SidebarProvider>
  )
}

export function StaffApplicationPage({
  id,
  role,
}: {
  id: string
  role: StaffRole
}) {
  const { t } = useTranslation()
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6">
      <Link
        to={role === 'normcontrol' ? '/normcontrol' : '/approver'}
        className="inline-flex items-center gap-1 self-start text-sm text-muted-foreground hover:text-foreground"
      >
        <IconArrowLeft className="size-4" />
        {t('application.back')}
      </Link>
      <ApplicationReview id={id} role={role} layout="page" />
    </main>
  )
}
