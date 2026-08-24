import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { migrate, openDb } from './connection'
import { MIGRATIONS } from './migrations'

describe('migration 6', () => {
  it('fait passer une base v5 peuplée en v6 sans perte', () => {
    const db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    for (let i = 0; i < 5; i++) db.exec(MIGRATIONS[i])
    db.pragma('user_version = 5')
    db.prepare("INSERT INTO books (title) VALUES ('Livre v5')").run()
    const chapId = db
      .prepare("INSERT INTO chapters (book_id, position, title) VALUES (1, 1, 'Ch. 1')")
      .run().lastInsertRowid

    migrate(db)

    expect(db.pragma('user_version', { simple: true })).toBe(MIGRATIONS.length)
    const chapter = db.prepare('SELECT id, word_goal FROM chapters WHERE id = ?').get(chapId) as any
    expect(chapter.id).toBe(chapId)
    expect(chapter.word_goal).toBeNull()
  })

  it('une base neuve part directement en v6', () => {
    const db = openDb(':memory:')
    expect(db.pragma('user_version', { simple: true })).toBe(MIGRATIONS.length)
    db.close()
  })
})

