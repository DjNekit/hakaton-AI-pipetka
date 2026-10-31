export interface MailboxMessage {
  type: string
  otp?: string
  url?: string
}

const mailbox = new Map<string, MailboxMessage>()

export function deliver(email: string, message: MailboxMessage) {
  mailbox.set(email, message)
}

export function readMailbox(email: string) {
  return mailbox.get(email)
}
