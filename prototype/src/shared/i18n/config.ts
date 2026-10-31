import './types'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { z } from 'zod'

import ru, { zod as zodRu } from './locales/ru'
import { zodErrorMap } from './zod-error-map'

export const resources = {
  ru: { translation: ru, zod: zodRu },
} as const

void i18n.use(initReactI18next).init({
  resources,
  lng: 'ru',
  fallbackLng: 'ru',
  interpolation: { escapeValue: false },
})

z.setErrorMap(zodErrorMap)

export default i18n
export { z }
