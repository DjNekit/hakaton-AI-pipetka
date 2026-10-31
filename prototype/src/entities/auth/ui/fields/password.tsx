import { IconEye, IconEyeOff } from '@tabler/icons-react'
import { type HTMLInputAutoCompleteAttribute, useState } from 'react'

import { useTranslation } from '@/shared/i18n'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
} from '@/shared/ui/components/input-group'
import { fieldComponents } from '@/shared/ui/form'

export function AuthPasswordField({
  label,
  autoComplete,
  autoFocus,
}: {
  label: string
  autoComplete: HTMLInputAutoCompleteAttribute | undefined
  autoFocus?: boolean
}) {
  const { t } = useTranslation()
  const [visible, setVisible] = useState(false)
  return (
    <fieldComponents.Root>
      <fieldComponents.Label>{label}</fieldComponents.Label>
      <InputGroup>
        <fieldComponents.InputGroupInput
          type={visible ? 'text' : 'password'}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
        />
        <InputGroupAddon align="inline-end">
          <InputGroupButton
            onClick={() => setVisible(v => !v)}
            aria-label={t('auth.passwordField.showPassword')}
            aria-pressed={visible}
          >
            {visible ? <IconEye /> : <IconEyeOff />}
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
      <fieldComponents.Error />
    </fieldComponents.Root>
  )
}
