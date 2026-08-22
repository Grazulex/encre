import Database from 'better-sqlite3'
import { MIGRATIONS } from './migrations'

export type Db = Database.Database

export function migrate(db: Db): void {
  const current = db.pragma('user_version', { simple: true }) as number
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v])
      db.pragma(`user_version = ${v + 1}`)
    })()
  }
}

export function openDb(path: string): Db {
  const db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  migrate(db)
  return db
}
