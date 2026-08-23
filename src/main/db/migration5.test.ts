import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { migrate, openDb } from './connection'
import { MIGRATIONS } from './migrations'

describe('migration 5', () => {
  it('fait passer une base v4 peuplée en v5 sans perte', () => {
    const db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    db.exec(MIGRATIONS[0]); db.exec(MIGRATIONS[1]); db.exec(MIGRATIONS[2]); db.exec(MIGRATIONS[3])
    db.pragma('user_version = 4')
    db.prepare("INSERT INTO books (title) VALUES ('Livre v4')").run()

    migrate(db)

    expect(db.pragma('user_version', { simple: true })).toBe(MIGRATIONS.length)
    const book = db.prepare('SELECT id, page_format FROM books WHERE id = 1').get() as any
    expect(book.id).toBe(1)
    expect(book.page_format).toBe('broche')
  })

  it('une base neuve part directement en v5', () => {
    const db = openDb(':memory:')
    expect(db.pragma('user_version', { simple: true })).toBe(MIGRATIONS.length)
    db.close()
  })
})
