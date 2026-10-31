import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

import Database from 'better-sqlite3'

const MIGRATIONS_DIR = path.resolve(process.cwd(), 'better-auth_migrations')

export function createDb() {
  const dbPath = process.env.AUTH_DB_PATH ?? './dev-auth.db'
  const db = new Database(dbPath)
  if (dbPath === ':memory:') {
    for (const file of readdirSync(MIGRATIONS_DIR).sort()) {
      if (file.endsWith('.sql')) {
        db.exec(readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8'))
      }
    }
  }
  return db
}
