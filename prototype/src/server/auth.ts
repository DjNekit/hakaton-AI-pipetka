import { betterAuth } from 'better-auth'
import { emailOTP } from 'better-auth/plugins'
import { tanstackStartCookies } from 'better-auth/tanstack-start'

import { createDb } from './auth-db'
import { deliver } from './mailbox'

function approverEmails() {
  return (process.env.APPROVER_EMAILS ?? '')
    .split(',')
    .map(email => email.trim().toLowerCase())
    .filter(Boolean)
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

export const auth = betterAuth({
  baseURL: baseURL(),
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
            role: approverEmails().includes(user.email.toLowerCase())
              ? 'approver'
              : 'applicant',
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
    tanstackStartCookies(),
  ],
})
