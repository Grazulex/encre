import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { migrate, openDb } from './connection'
import { MIGRATIONS } from './migrations'

describe('migration 4', () => {
  it('fait passer une base v3 peuplée en v4 sans perte', () => {
    const db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    db.exec(MIGRATIONS[0])
    db.exec(MIGRATIONS[1])
    db.exec(MIGRATIONS[2])
    db.pragma('user_version = 3')
    db.prepare("INSERT INTO books (title) VALUES ('Livre v3')").run()

    migrate(db)

    expect(db.pragma('user_version', { simple: true })).toBe(MIGRATIONS.length)
    const tables = db
      .prepare<unknown[], { name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
      )
      .all()
      .map((r) => r.name)
    expect(tables).toContain('illustrations')
    const book = db
      .prepare<unknown[], { id: number }>('SELECT id FROM books WHERE id = 1')
      .get() as { id: number }
    expect(book.id).toBe(1)
    db.close()
  })

  it('une base neuve part directement en v4', () => {
    const db = openDb(':memory:')
    expect(db.pragma('user_version', { simple: true })).toBe(MIGRATIONS.length)
    db.close()
  })
})
