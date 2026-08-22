import { describe, it, expect, beforeEach } from 'vitest'
import { openDb, type Db } from './connection'
import { createSnapshot, listSnapshots, getSnapshotContent, deleteSnapshot } from './snapshots'

let db: Db
beforeEach(() => {
  db = openDb(':memory:')
})

describe('repository snapshots', () => {
  it('crée un snapshot avec contenu et raison', () => {
    db.prepare('INSERT INTO books (title) VALUES (?)').run('Livre')
    db.prepare('INSERT INTO chapters (book_id, position, title) VALUES (1, 1, ?)').run('Ch. 1')

    const snapshot = createSnapshot(db, 1, JSON.stringify({ type: 'doc', content: [] }), 'ia')
    expect(snapshot.id).toBeGreaterThan(0)
    expect(snapshot.chapterId).toBe(1)
    expect(snapshot.reason).toBe('ia')
    expect(snapshot.createdAt).toBeDefined()
  })

  it('listSnapshots retourne les snapshots en order décroissant (desc)', () => {
    db.prepare('INSERT INTO books (title) VALUES (?)').run('Livre')
    db.prepare('INSERT INTO chapters (book_id, position, title) VALUES (1, 1, ?)').run('Ch. 1')

    const s1 = createSnapshot(db, 1, JSON.stringify({}), 'ia')
    const s2 = createSnapshot(db, 1, JSON.stringify({}), 'manual')
    const s3 = createSnapshot(db, 1, JSON.stringify({}), 'ia')

    const list = listSnapshots(db, 1)
    expect(list).toHaveLength(3)
    expect(list[0].id).toBe(s3.id)
    expect(list[1].id).toBe(s2.id)
    expect(list[2].id).toBe(s1.id)
  })

  it('getSnapshotContent retourne le JSON du snapshot', () => {
    db.prepare('INSERT INTO books (title) VALUES (?)').run('Livre')
    db.prepare('INSERT INTO chapters (book_id, position, title) VALUES (1, 1, ?)').run('Ch. 1')

    const content = JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', text: 'test' }] })
    const snapshot = createSnapshot(db, 1, content, 'ia')

    const retrieved = getSnapshotContent(db, snapshot.id)
    expect(retrieved).toBe(content)
  })

  it('createSnapshot prune à 50 snapshots les plus récents par chapitre', () => {
    db.prepare('INSERT INTO books (title) VALUES (?)').run('Livre')
    db.prepare('INSERT INTO chapters (book_id, position, title) VALUES (1, 1, ?)').run('Ch. 1')

    // Créer 60 snapshots
    for (let i = 0; i < 60; i++) {
      createSnapshot(db, 1, JSON.stringify({ i }), 'ia')
    }

    const list = listSnapshots(db, 1)
    expect(list).toHaveLength(50)
  })

  it('createSnapshot prune indépendamment par chapitre', () => {
    db.prepare('INSERT INTO books (title) VALUES (?)').run('Livre')
    db.prepare('INSERT INTO chapters (book_id, position, title) VALUES (1, 1, ?)').run('Ch. 1')
    db.prepare('INSERT INTO chapters (book_id, position, title) VALUES (1, 2, ?)').run('Ch. 2')

    // 15 snapshots pour ch. 1, 10 pour ch. 2
    for (let i = 0; i < 15; i++) createSnapshot(db, 1, JSON.stringify({ i }), 'ia')
    for (let i = 0; i < 10; i++) createSnapshot(db, 2, JSON.stringify({ i }), 'ia')

    expect(listSnapshots(db, 1)).toHaveLength(15)
    expect(listSnapshots(db, 2)).toHaveLength(10)
  })

  it('deleteSnapshot supprime un snapshot spécifique', () => {
    db.prepare('INSERT INTO books (title) VALUES (?)').run('Livre')
    db.prepare('INSERT INTO chapters (book_id, position, title) VALUES (1, 1, ?)').run('Ch. 1')

    const s1 = createSnapshot(db, 1, JSON.stringify({ id: 1 }), 'ia')
    const s2 = createSnapshot(db, 1, JSON.stringify({ id: 2 }), 'manual')
    const s3 = createSnapshot(db, 1, JSON.stringify({ id: 3 }), 'ia')

    deleteSnapshot(db, s2.id)

    const list = listSnapshots(db, 1)
    expect(list).toHaveLength(2)
    expect(list.map((s) => s.id)).not.toContain(s2.id)
    expect(list.map((s) => s.id)).toContain(s1.id)
    expect(list.map((s) => s.id)).toContain(s3.id)
  })
})
