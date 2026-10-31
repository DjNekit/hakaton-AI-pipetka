import { fieldComponents } from '@/shared/ui/form'

export function AuthEmailField({
  label,
  autoFocus,
}: {
  label: string
  autoFocus?: boolean
}) {
  return (
    <fieldComponents.Root>
      <fieldComponents.Label>{label}</fieldComponents.Label>
      <fieldComponents.Input
        type="email"
        autoComplete="email"
        autoFocus={autoFocus}
      />
      <fieldComponents.Error />
    </fieldComponents.Root>
  )
}
