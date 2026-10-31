import { useTranslation } from '@/shared/i18n'
import { Button } from '@/shared/ui/components/button'
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/shared/ui/components/card'

export function ConnectionError({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation()
  return (
    <main className={'flex min-h-svh items-center justify-center'}>
      <Card className={'w-full max-w-sm'}>
        <CardHeader>
          <CardTitle>{t('common.connectionError.title')}</CardTitle>
          <CardDescription>
            {t('common.connectionError.description')}
          </CardDescription>
        </CardHeader>
        <CardFooter className={'flex-col gap-4'}>
          <Button className={'w-full'} onClick={onRetry}>
            {t('common.connectionError.retryButton')}
          </Button>
        </CardFooter>
      </Card>
    </main>
  )
}
