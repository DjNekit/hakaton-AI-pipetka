import type { ComponentProps } from 'react'

import { Textarea } from '@/shared/ui/components/textarea'

import { useFieldContext } from '../form-context'
import { getFieldErrorId, getFieldId } from '../utils'

export function AppTextarea({ ...props }: ComponentProps<typeof Textarea>) {
  const field = useFieldContext<string>()
  const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid
  return (
    <Textarea
      id={getFieldId(field)}
      name={field.name}
      value={field.state.value}
      onBlur={field.handleBlur}
      onChange={e => field.handleChange(e.target.value)}
      aria-invalid={isInvalid}
      aria-describedby={isInvalid ? getFieldErrorId(field) : undefined}
      {...props}
    />
  )
}
