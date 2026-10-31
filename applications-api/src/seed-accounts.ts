import { randomUUID } from 'node:crypto'

import { hashPassword } from 'better-auth/crypto'

import { createDb } from './auth-db'

const ACCOUNTS = [
  { email: 'test24397@example.com', name: 'Тестовый заявитель', role: 'applicant' },
  { email: 'approver@example.com', name: 'Тестовый согласующий', role: 'approver' },
  { email: 'normcontrol@example.com', name: 'Тестовый нормоконтролёр', role: 'normcontrol' },
] as const

// Запускается после миграций better-auth. Существующие пароли и заявки сохраняются.
export async function seedDemoAccounts() {
  if (process.env.SEED_DEMO_ACCOUNTS === '0') return
  const db = createDb()
  db.pragma('busy_timeout = 5000')
  try {
    for (const account of ACCOUNTS) {
      const existing = db.prepare<[string], { id: string }>('select id from user where email = ?').get(account.email)
      const credential = existing && db.prepare<[string], { id: string }>(
        "select id from account where userId = ? and providerId = 'credential' and password is not null",
      ).get(existing.id)
      const password = credential ? null : await hashPassword('password123')
      db.transaction(() => {
        // Повторная проверка под блокировкой на случай одновременного запуска процессов.
        const user = db.prepare<[string], { id: string }>('select id from user where email = ?').get(account.email)
        const userId = user?.id ?? randomUUID()
        const now = new Date().toISOString()
        if (!user) {
          db.prepare(`insert into user (id, name, email, emailVerified, role, createdAt, updatedAt)
            values (?, ?, ?, 1, ?, ?, ?)`).run(userId, account.name, account.email, account.role, now, now)
        } else {
          db.prepare('update user set role = ?, emailVerified = 1 where id = ? and (role is not ? or emailVerified != 1)')
            .run(account.role, userId, account.role)
        }
        const current = db.prepare<[string], { id: string; password: string | null }>(
          "select id, password from account where userId = ? and providerId = 'credential'",
        ).get(userId)
        if (!current) {
          if (!password) throw new Error('Не подготовлен пароль тестового аккаунта')
          db.prepare(`insert into account (id, accountId, providerId, userId, password, createdAt, updatedAt)
            values (?, ?, 'credential', ?, ?, ?, ?)`).run(randomUUID(), userId, userId, password, now, now)
        } else if (!current.password && password) {
          db.prepare('update account set password = ?, updatedAt = ? where id = ?').run(password, now, current.id)
        }
      }).immediate()
    }
    console.log('applications-api: тестовые аккаунты готовы (заявитель, согласующий, нормоконтролёр)')
  } finally {
    db.close()
  }
}
