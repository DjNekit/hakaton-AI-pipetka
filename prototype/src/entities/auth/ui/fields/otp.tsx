import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from '@/shared/ui/components/input-otp'
import {
  fieldComponents,
  getFieldErrorId,
  getFieldId,
  useFieldContext,
} from '@/shared/ui/form'

const OTP_LENGTH = 6

export function AuthOtpField({
  label,
  autoFocus,
}: {
  label: string
  autoFocus?: boolean
}) {
  const field = useFieldContext<string>()
  const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid
  return (
    <fieldComponents.Root>
      <fieldComponents.Label>{label}</fieldComponents.Label>
      <InputOTP
        id={getFieldId(field)}
        name={field.name}
        maxLength={OTP_LENGTH}
        pattern={'^\\d+$'}
        autoComplete="one-time-code"
        autoFocus={autoFocus}
        value={field.state.value}
        onChange={field.handleChange}
        onBlur={field.handleBlur}
        aria-invalid={isInvalid}
        aria-describedby={isInvalid ? getFieldErrorId(field) : undefined}
      >
        <InputOTPGroup>
          {Array.from({ length: OTP_LENGTH }, (_, index) => (
            <InputOTPSlot key={index} index={index} />
          ))}
        </InputOTPGroup>
      </InputOTP>
      <fieldComponents.Error />
    </fieldComponents.Root>
  )
}
