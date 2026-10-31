import { Spinner } from '@/shared/ui/components/spinner'

export const SpinnerAddon = ({ enabled }: { enabled: boolean }) => (
  <span
    aria-hidden
    className="grid transition-[grid-template-columns] duration-200"
    style={{ gridTemplateColumns: enabled ? '1fr' : '0fr' }}
  >
    <span className="flex overflow-hidden">
      <Spinner data-icon={'inline-start'} />
    </span>
  </span>
)
