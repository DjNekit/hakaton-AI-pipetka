import {
  emailOTPClient,
  inferAdditionalFields,
} from 'better-auth/client/plugins'
import { createAuthClient } from 'better-auth/react'

// better-auth на сервисе prototype-api: /new/api/auth (полный адрес — из текущего origin)
export const authClient = createAuthClient({
  baseURL: `${window.location.origin}/new/api/auth`,
  plugins: [
    emailOTPClient(),
    inferAdditionalFields({
      user: { role: { type: 'string', required: false, input: false } },
    }),
  ],
})
