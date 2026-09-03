import { describe, it, expect } from 'vitest'
import { openDb } from './connection'
import { MIGRATIONS } from './migrations'

describe('openDb', () => {
  it('applique les migrations sur une base neuve', () => {
    const db = openDb(':memory:')
    expect(db.pragma('user_version', { simple: true })).toBe(MIGRATIONS.length)
    const tables = db
      .prepare<unknown[], { name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
      )
      .all()
      .map((r) => r.name)
    expect(tables).toContain('books')
    expect(tables).toContain('chapters')
    db.close()
  })

  it('active les clés étrangères', () => {
    const db = openDb(':memory:')
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1)
    db.close()
  })

  it('est idempotent (réouverture sans erreur)', () => {
    const db = openDb(':memory:')
    expect(() => {
      const again = openDb(':memory:')
      again.close()
    }).not.toThrow()
    db.close()
  })
})
