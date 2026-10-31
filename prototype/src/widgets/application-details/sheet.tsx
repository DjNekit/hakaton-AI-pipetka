import { IconExternalLink } from '@tabler/icons-react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'

import {
  ApplicationNumber,
  applicationQueryOptions,
} from '@/entities/application'
import { useTranslation } from '@/shared/i18n'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/shared/ui/components/sheet'

import { ApplicationReview } from './ui'

export function ApplicationSheet({
  id,
  onClose,
}: {
  id: string | undefined
  onClose: () => void
}) {
  const { t } = useTranslation()
  const { data } = useQuery({
    ...applicationQueryOptions(id ?? ''),
    enabled: Boolean(id),
  })

  return (
    <Sheet open={Boolean(id)} onOpenChange={open => !open && onClose()}>
      <SheetContent className="w-full gap-0 overflow-y-auto data-[side=right]:sm:max-w-2xl">
        <SheetHeader className="gap-1 border-b pr-12">
          <div className="flex items-center gap-3">
            {data && <ApplicationNumber number={data.number} />}
            {id && (
              <Link
                to="/approver/$id"
                params={{ id }}
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <IconExternalLink className="size-3.5" />
                {t('application.openPage')}
              </Link>
            )}
          </div>
          <SheetTitle className="text-lg">{data?.address}</SheetTitle>
          {data?.description && (
            <SheetDescription className="whitespace-pre-wrap">
              {data.description}
            </SheetDescription>
          )}
        </SheetHeader>
        <div className="p-6">
          {id && <ApplicationReview id={id} layout="sheet" />}
        </div>
      </SheetContent>
    </Sheet>
  )
}
