import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import Database from 'better-sqlite3'

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../migrations',
)

// Схема better-auth (migrations/*.sql) создаётся при первом запуске на пустой базе.
export function createDb() {
  const db = new Database(process.env.AUTH_DB_PATH ?? './dev-auth.db')
  const hasUsers = db
    .prepare("select 1 from sqlite_master where type = 'table' and name = 'user'")
    .get()
  if (!hasUsers) {
    for (const file of readdirSync(MIGRATIONS_DIR).sort()) {
      if (file.endsWith('.sql')) {
        db.exec(readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8'))
      }
    }
  }
  return db
}
