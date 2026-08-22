import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'

describe('environnement de test', () => {
  it('charge better-sqlite3 en mémoire', () => {
    const db = new Database(':memory:')
    expect(db.prepare('SELECT 1 AS un').get()).toEqual({ un: 1 })
    db.close()
  })
})
