import Database from 'better-sqlite3'

// SQLite для better-auth и заявок; схему better-auth создаёт и дополняет getMigrations() при старте (index.ts).
export function createDb() {
  return new Database(process.env.AUTH_DB_PATH ?? './dev-auth.db')
}
