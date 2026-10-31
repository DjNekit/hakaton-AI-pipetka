import { useEffect, useRef, type ComponentProps } from 'react'

import { cn } from '@/shared/ui/lib/utils'

import { useFormContext } from '../form-context'

function resolveMessage(error: unknown): string | null {
  if (typeof error === 'string') return error
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return String(error.message)
  }
  return null
}

function FormErrorAlert({
  message,
  className,
  ...props
}: ComponentProps<'div'> & { message: string }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    ref.current?.focus()
  }, [message])

  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="alert"
      data-slot="form-error"
      className={cn(
        'rounded-md border border-destructive/20 bg-destructive/10 px-3 py-1 text-xs/relaxed font-normal text-destructive',
        className,
      )}
      {...props}
    >
      {message}
    </div>
  )
}

export function AppFormError({ id, ...props }: ComponentProps<'div'>) {
  const form = useFormContext()

  return (
    <form.Subscribe selector={state => state.errorMap.onSubmit}>
      {error => {
        const message = resolveMessage(error)
        if (!message) return null
        return (
          <FormErrorAlert
            id={id ?? `${form.formId}-form-error`}
            message={message}
            {...props}
          />
        )
      }}
    </form.Subscribe>
  )
}
