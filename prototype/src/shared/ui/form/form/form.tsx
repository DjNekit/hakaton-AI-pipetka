import type { ComponentProps } from 'react'

import { useFormContext } from '../form-context'

export function AppForm({ onSubmit, ...props }: ComponentProps<'form'>) {
  const form = useFormContext()

  return (
    <form
      data-slot="form"
      noValidate
      onSubmit={event => {
        event.preventDefault()
        event.stopPropagation()
        onSubmit?.(event)
        void form.handleSubmit()
      }}
      {...props}
    />
  )
}
