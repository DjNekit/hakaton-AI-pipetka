import type { ReactNode } from 'react'

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/shared/ui/components/card'
import { FieldGroup } from '@/shared/ui/components/field'
import { formComponents } from '@/shared/ui/form'

export function AuthCard({
  title,
  description,
  children,
}: {
  title: string
  description?: ReactNode
  children: ReactNode
}) {
  return (
    <Card className={'w-full max-w-sm'}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description != null && (
          <CardDescription>{description}</CardDescription>
        )}
      </CardHeader>
      {children}
    </Card>
  )
}

export function AuthCardForm({
  children,
  footer,
}: {
  children: ReactNode
  footer?: ReactNode
}) {
  return (
    <formComponents.Root className={'flex flex-col gap-4'}>
      <CardContent>
        <FieldGroup>
          <formComponents.Error />
          {children}
        </FieldGroup>
      </CardContent>
      {footer != null && (
        <CardFooter className={'flex-col gap-4'}>{footer}</CardFooter>
      )}
    </formComponents.Root>
  )
}
