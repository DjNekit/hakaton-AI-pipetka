import type { ComponentProps } from 'react'

import { Input } from '@/shared/ui/components/input'

import { useFieldContext } from '../form-context'
import { getFieldErrorId, getFieldId } from '../utils'

export function AppFileInput({
  ...props
}: Omit<ComponentProps<typeof Input>, 'type' | 'value' | 'onChange'>) {
  const field = useFieldContext<File | null>()
  const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid
  return (
    <Input
      type="file"
      id={getFieldId(field)}
      name={field.name}
      onBlur={field.handleBlur}
      onChange={e => {
        field.handleChange(e.target.files?.[0] ?? null)
        field.handleBlur()
      }}
      aria-invalid={isInvalid}
      aria-describedby={isInvalid ? getFieldErrorId(field) : undefined}
      {...props}
    />
  )
}
