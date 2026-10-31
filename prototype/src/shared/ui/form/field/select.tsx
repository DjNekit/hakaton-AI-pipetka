import type { ComponentProps } from 'react'

import {
  NativeSelect,
  NativeSelectOption,
} from '@/shared/ui/components/native-select'

import { useFieldContext } from '../form-context'
import { getFieldErrorId, getFieldId } from '../utils'

export function AppSelect({
  options,
  ...props
}: Omit<ComponentProps<typeof NativeSelect>, 'children'> & {
  options: ReadonlyArray<{ value: string; label: string }>
}) {
  const field = useFieldContext<string>()
  const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid
  return (
    <NativeSelect
      id={getFieldId(field)}
      name={field.name}
      value={field.state.value}
      onBlur={field.handleBlur}
      onChange={e => field.handleChange(e.target.value)}
      aria-invalid={isInvalid}
      aria-describedby={isInvalid ? getFieldErrorId(field) : undefined}
      {...props}
    >
      {options.map(option => (
        <NativeSelectOption key={option.value} value={option.value}>
          {option.label}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  )
}
