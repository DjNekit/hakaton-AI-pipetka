import { IconLayoutKanban, IconList } from '@tabler/icons-react'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useCallback, type CSSProperties } from 'react'

import { applicationsQueryOptions } from '@/entities/application'
import { useTranslation, z } from '@/shared/i18n'
import { SidebarInset, SidebarProvider } from '@/shared/ui/components/sidebar'
import { Skeleton } from '@/shared/ui/components/skeleton'
import {
  ToggleGroup,
  ToggleGroupItem,
} from '@/shared/ui/components/toggle-group'
import { ApplicationSidebar } from '@/widgets/application-details'
import { ApplicationsBoard } from '@/widgets/applications-board'
import { ApplicationsTable } from '@/widgets/applications-table'

const searchSchema = z.object({
  view: z.enum(['board', 'table']).optional().catch(undefined),
  selected: z.string().optional().catch(undefined),
})

export const Route = createFileRoute('/_authenticated/approver/')({
  validateSearch: searchSchema,
  component: Applications,
})

function Applications() {
  const { t } = useTranslation()
  const { view = 'board', selected } = Route.useSearch()
  const navigate = Route.useNavigate()
  const { data, isPending, isError } = useQuery(applicationsQueryOptions())
  const panelId = view === 'board' ? selected : undefined
  const closePanel = useCallback(
    () => void navigate({ search: prev => ({ ...prev, selected: undefined }) }),
    [navigate],
  )

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
                void navigate({ search: prev => ({ ...prev, view: next }) })
              }
            }}
            variant="outline"
            size="sm"
          >
            <ToggleGroupItem
              value="board"
              aria-label={t('approver.board.viewBoard')}
            >
              <IconLayoutKanban />
              {t('approver.board.viewBoard')}
            </ToggleGroupItem>
            <ToggleGroupItem
              value="table"
              aria-label={t('approver.board.viewTable')}
            >
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
          <ApplicationsBoard applications={data} selectedId={selected} />
        )}
        {data && view === 'table' && (
          <ApplicationsTable
            applications={data}
            detailRoute="/approver/$id"
            showApplicant
          />
        )}
      </SidebarInset>
      <ApplicationSidebar id={panelId} onClose={closePanel} />
    </SidebarProvider>
  )
}
