import { fieldComponents } from '@/shared/ui/form'

export function AuthNameField({
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
        type="text"
        autoComplete="name"
        autoFocus={autoFocus}
      />
      <fieldComponents.Error />
    </fieldComponents.Root>
  )
}
