import type { ComponentProps } from 'react'

import { Button } from '@/shared/ui/components/button'
import { SpinnerAddon } from '@/shared/ui/components/spinner-addon'

import { useFormContext } from '../form-context'

export function AppSubmitButton({
  children,
  ...rest
}: ComponentProps<typeof Button>) {
  const form = useFormContext()

  return (
    <form.Subscribe
      selector={state => ({
        isLoading: state.isSubmitting,
        isDisabled: !state.canSubmit,
      })}
    >
      {({ isLoading, isDisabled }) => (
        <Button
          type="submit"
          {...rest}
          disabled={isDisabled}
          aria-busy={isLoading}
        >
          <SpinnerAddon enabled={isLoading} />
          {children}
        </Button>
      )}
    </form.Subscribe>
  )
}
