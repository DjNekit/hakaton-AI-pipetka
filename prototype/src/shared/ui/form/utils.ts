import {
  defaultValidationLogic,
  type ValidationLogicFn,
  type ValidationLogicValidatorsFn,
} from '@tanstack/react-form'

export const blurFirstValidationLogic: ValidationLogicFn = props => {
  const validatorNames = Object.keys(props.validators ?? {})
  if (validatorNames.length === 0) {
    return props.runValidation({
      validators: [],
      form: props.form,
    })
  }

  let defaultValidators: ValidationLogicValidatorsFn[] = []
  defaultValidationLogic({
    ...props,
    runValidation: vProps => {
      defaultValidators = vProps.validators as ValidationLogicValidatorsFn[]
    },
  })

  const field =
    props.event.fieldName != null
      ? props.form.baseStore.state.fieldMetaBase[props.event.fieldName]
      : undefined

  const dynamicValidator = {
    fn: props.event.async
      ? props.validators!['onDynamicAsync']
      : props.validators!['onDynamic'],
    cause: 'dynamic',
  } as const

  const validatorsToAdd: ValidationLogicValidatorsFn[] = []

  const submissionAttempts = props.group
    ? props.group.state.meta.submissionAttempts
    : props.form.state.submissionAttempts
  const additionalMode =
    (field?.isBlurred && field?.isDirty) || submissionAttempts
      ? ['change', 'blur']
      : []
  if ([...additionalMode, 'submit'].includes(props.event.type)) {
    validatorsToAdd.push(dynamicValidator)
  }

  return props.runValidation({
    validators: [...defaultValidators, ...validatorsToAdd],
    form: props.form,
  })
}

export function getFieldId(field: { form: { formId: string }; name: string }) {
  return `${field.form.formId}-${field.name}`
}

export function getFieldErrorId(field: {
  form: { formId: string }
  name: string
}) {
  return `${getFieldId(field)}-error`
}
