import { Link } from '@tanstack/react-router'

import { useTranslation } from '@/shared/i18n'
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/shared/ui/components/card'

export function NotFound() {
  const { t } = useTranslation()
  return (
    <main className={'flex min-h-svh items-center justify-center'}>
      <Card className={'w-full max-w-sm'}>
        <CardHeader>
          <CardTitle>{t('common.notFound.title')}</CardTitle>
          <CardDescription>{t('common.notFound.description')}</CardDescription>
        </CardHeader>
        <CardFooter className={'flex-col gap-4'}>
          <Link
            to={'/'}
            className={
              'text-sm text-foreground underline-offset-4 hover:underline'
            }
          >
            {t('common.notFound.homeLink')}
          </Link>
        </CardFooter>
      </Card>
    </main>
  )
}
