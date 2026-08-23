import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { migrate, openDb } from './connection'
import { MIGRATIONS } from './migrations'

describe('migration 3', () => {
  it('fait passer une base v2 peuplée en v3 sans perte', () => {
    const db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    // état v2 exact
    db.exec(MIGRATIONS[0])
    db.exec(MIGRATIONS[1])
    db.pragma('user_version = 2')
    db.prepare("INSERT INTO books (title) VALUES ('Livre v2')").run()
    db.prepare('INSERT INTO chapters (book_id, position, title) VALUES (1, 1, ?)').run('Ch. 1')

    migrate(db)

    expect(db.pragma('user_version', { simple: true })).toBe(MIGRATIONS.length)
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((r: any) => r.name)
    for (const t of ['snapshots', 'ai_sessions', 'ai_messages', 'series']) {
      expect(tables).toContain(t)
    }
    // books.series_id colonne ajoutée
    const book = db.prepare('SELECT id, series_id FROM books WHERE id = 1').get() as any
    expect(book.id).toBe(1)
    expect(book.series_id).toBeNull()
    // chapitre intact
    const ch = db.prepare('SELECT title FROM chapters WHERE id = 1').get() as any
    expect(ch.title).toBe('Ch. 1')
    db.close()
  })

  it('une base neuve part directement en v3', () => {
    const db = openDb(':memory:')
    expect(db.pragma('user_version', { simple: true })).toBe(MIGRATIONS.length)
    db.close()
  })
})
