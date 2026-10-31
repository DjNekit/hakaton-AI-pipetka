import { IconExternalLink, IconX } from '@tabler/icons-react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useEffect, useRef } from 'react'

import {
  ApplicationNumber,
  applicationQueryOptions,
} from '@/entities/application'
import { useTranslation } from '@/shared/i18n'
import { Button } from '@/shared/ui/components/button'
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  useSidebar,
} from '@/shared/ui/components/sidebar'

import { ApplicationReview } from './ui'

function useMobileSync(id: string | undefined, onClose: () => void) {
  const { isMobile, openMobile, setOpenMobile } = useSidebar()
  const wasOpen = useRef(false)

  useEffect(() => {
    if (isMobile) setOpenMobile(Boolean(id))
  }, [isMobile, id, setOpenMobile])

  useEffect(() => {
    if (isMobile && wasOpen.current && !openMobile && id) onClose()
    wasOpen.current = openMobile
  }, [isMobile, openMobile, id, onClose])
}

function PanelContent({ id, onClose }: { id: string; onClose: () => void }) {
  const { t } = useTranslation()
  const { data } = useQuery(applicationQueryOptions(id))

  return (
    <>
      <SidebarHeader className="h-12 flex-row items-center gap-3 border-b px-4">
        {data && <ApplicationNumber number={data.number} />}
        <Link
          to="/approver/$id"
          params={{ id }}
          className="inline-flex items-center gap-1 text-xs whitespace-nowrap text-muted-foreground hover:text-foreground"
        >
          <IconExternalLink className="size-3.5" />
          {t('application.openPage')}
        </Link>
        <Button
          variant="ghost"
          size="icon-sm"
          className="ml-auto"
          aria-label={t('application.closePanel')}
          onClick={onClose}
        >
          <IconX />
        </Button>
      </SidebarHeader>
      <SidebarContent className="gap-6 px-4 py-5">
        {data && (
          <div className="flex flex-col gap-1">
            <h2 className="text-lg font-semibold">{data.address}</h2>
            {data.description && (
              <p className="text-sm whitespace-pre-wrap text-muted-foreground">
                {data.description}
              </p>
            )}
          </div>
        )}
        <ApplicationReview id={id} layout="panel" />
      </SidebarContent>
    </>
  )
}

export function ApplicationSidebar({
  id,
  onClose,
}: {
  id: string | undefined
  onClose: () => void
}) {
  useMobileSync(id, onClose)

  useEffect(() => {
    if (!id) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [id, onClose])

  return (
    <Sidebar
      side="right"
      collapsible="offcanvas"
      className="md:top-14 md:h-[calc(100svh-3.5rem)]"
    >
      {id && <PanelContent id={id} onClose={onClose} />}
    </Sidebar>
  )
}
