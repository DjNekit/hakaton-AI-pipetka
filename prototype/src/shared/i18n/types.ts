import type { zod as zodRu } from './locales/ru'
import type ru from './locales/ru'

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation'
    resources: {
      translation: typeof ru
      zod: typeof zodRu
    }
  }
}
