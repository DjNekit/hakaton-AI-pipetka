import { createFormHook } from '@tanstack/react-form'

import {
  AppChoice,
  AppFieldError,
  AppFieldLabel,
  AppFieldRoot,
  AppFileInput,
  AppInput,
  AppInputGroupInput,
  AppSelect,
  AppTextarea,
} from './field'
import { AppForm, AppSubmitButton, AppFormError } from './form'
import { fieldContext, formContext } from './form-context'

const fieldComponents = {
  Root: AppFieldRoot,
  Error: AppFieldError,
  Label: AppFieldLabel,
  Input: AppInput,
  InputGroupInput: AppInputGroupInput,
  Textarea: AppTextarea,
  Select: AppSelect,
  File: AppFileInput,
  Choice: AppChoice,
}

const formComponents = {
  Root: AppForm,
  Submit: AppSubmitButton,
  Error: AppFormError,
}

export const appForm = createFormHook({
  fieldContext,
  formContext,
  fieldComponents,
  formComponents,
})

export const { useAppForm } = appForm

export { useFieldContext, useFormContext } from './form-context'
export { fieldComponents, formComponents }

export * from './utils'
