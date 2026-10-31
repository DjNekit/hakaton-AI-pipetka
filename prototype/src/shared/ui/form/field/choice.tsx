import type { ReactNode } from 'react'

import {
  ToggleGroup,
  ToggleGroupItem,
} from '@/shared/ui/components/toggle-group'

import { useFieldContext } from '../form-context'
import { getFieldErrorId, getFieldId } from '../utils'

export function AppChoice({
  options,
  className,
}: {
  options: ReadonlyArray<{ value: string; label: ReactNode }>
  className?: string
}) {
  const field = useFieldContext<string>()
  const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid
  return (
    <ToggleGroup
      id={getFieldId(field)}
      value={field.state.value ? [field.state.value] : []}
      onValueChange={value => {
        field.handleChange(value[0] ?? '')
        field.handleBlur()
      }}
      variant="outline"
      size="sm"
      spacing={1}
      className={className}
      aria-invalid={isInvalid}
      aria-describedby={isInvalid ? getFieldErrorId(field) : undefined}
    >
      {options.map(option => (
        <ToggleGroupItem key={option.value} value={option.value}>
          {option.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}
