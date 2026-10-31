import type { ComponentProps } from 'react'

import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@/shared/ui/components/input-group'
import { SpinnerAddon } from '@/shared/ui/components/spinner-addon'

import { useFieldContext } from '../form-context'
import { getFieldErrorId, getFieldId } from '../utils'

export function AppInput({ ...props }: ComponentProps<typeof InputGroupInput>) {
  const field = useFieldContext<string | number | readonly string[]>()
  const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid
  const isValidating = field.state.meta.isValidating

  return (
    <InputGroup>
      <InputGroupInput
        id={getFieldId(field)}
        name={field.name}
        value={field.state.value}
        onBlur={field.handleBlur}
        onChange={e => field.handleChange(e.target.value)}
        aria-invalid={isInvalid}
        aria-describedby={isInvalid ? getFieldErrorId(field) : undefined}
        aria-busy={isValidating}
        {...props}
      />
      <InputGroupAddon
        align="inline-end"
        children={<SpinnerAddon enabled={isValidating} />}
      />
    </InputGroup>
  )
}

export function AppInputGroupInput({
  ...props
}: ComponentProps<typeof InputGroupInput>) {
  const field = useFieldContext<string | number | readonly string[]>()
  const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid
  return (
    <InputGroupInput
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
