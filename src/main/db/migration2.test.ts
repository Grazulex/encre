import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { migrate, openDb } from './connection'
import { MIGRATIONS } from './migrations'

describe('migration 2', () => {
  it('fait passer une base v1 peuplée en v2 sans perte', () => {
    const db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    // état v1 exact
    db.exec(MIGRATIONS[0])
    db.pragma('user_version = 1')
    db.prepare("INSERT INTO books (title) VALUES ('Livre v1')").run()
    db.prepare('INSERT INTO chapters (book_id, position, title) VALUES (1, 1, ?)').run('Ch. 1')

    migrate(db)

    expect(db.pragma('user_version', { simple: true })).toBe(MIGRATIONS.length)
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((r: any) => r.name)
    for (const t of ['entities', 'outline_notes', 'timeline_events', 'event_chapters', 'event_entities', 'mentions']) {
      expect(tables).toContain(t)
    }
    // colonne summary ajoutée, données intactes
    const ch = db.prepare('SELECT title, summary FROM chapters WHERE id = 1').get() as any
    expect(ch.title).toBe('Ch. 1')
    expect(ch.summary).toBe('')
    db.close()
  })

  it('une base neuve part directement en v2', () => {
    const db = openDb(':memory:')
    expect(db.pragma('user_version', { simple: true })).toBe(2)
    db.close()
  })
})
