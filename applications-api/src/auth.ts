import { betterAuth } from 'better-auth'
import { emailOTP } from 'better-auth/plugins'

import { createDb } from './auth-db'
import { deliver } from './mailbox'

function emailList(value: string | undefined) {
  return (value ?? '')
    .split(',')
    .map(email => email.trim().toLowerCase())
    .filter(Boolean)
}

function roleForEmail(email: string) {
  const normalized = email.toLowerCase()
  if (emailList(process.env.NORMCONTROL_EMAILS).includes(normalized)) {
    return 'normcontrol'
  }
  if (emailList(process.env.APPROVER_EMAILS).includes(normalized)) {
    return 'approver'
  }
  return 'applicant'
}

function baseURL() {
  const allowedHosts = (process.env.AUTH_ALLOWED_HOSTS ?? '')
    .split(',')
    .map(host => host.trim())
    .filter(Boolean)
  if (allowedHosts.length === 0) return process.env.BETTER_AUTH_URL
  return {
    allowedHosts,
    protocol: 'auto' as const,
    fallback: process.env.BETTER_AUTH_URL,
  }
}

// Клиент живёт на /new, API — на /new/api: адреса авторизации — /new/api/auth/*
export const AUTH_BASE_PATH = '/new/api/auth'

export const auth = betterAuth({
  baseURL: baseURL(),
  basePath: AUTH_BASE_PATH,
  database: createDb(),
  user: {
    additionalFields: {
      role: {
        type: 'string',
        required: false,
        defaultValue: 'applicant',
        input: false,
      },
    },
  },
  databaseHooks: {
    user: {
      create: {
        before: async user => ({
          data: {
            ...user,
            role: roleForEmail(user.email),
          },
        }),
      },
    },
  },
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    sendResetPassword: async ({ user, url }) => {
      deliver(user.email, { type: 'reset-password', url })
      console.log(`[auth] Password reset email for ${user.email}:\n${url}`)
    },
    revokeSessionsOnPasswordReset: true,
    onExistingUserSignUp: async ({ user }) => {
      deliver(user.email, { type: 'existing-user' })
      console.log(
        `[auth] Existing-account notice for ${user.email} (verified: ${user.emailVerified}): someone attempted to sign up with this address.`,
      )
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
  },
  plugins: [
    emailOTP({
      disableSignUp: true,
      overrideDefaultEmailVerification: true,
      sendVerificationOTP: async ({ email, otp, type }) => {
        deliver(email, { type, otp })
        console.log(`[auth] ${type} OTP for ${email}: ${otp}`)
      },
    }),
  ],
})
