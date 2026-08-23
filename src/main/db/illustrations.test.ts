import { describe, it, expect } from 'vitest'
import { openDb } from './connection'
import { createBook } from './books'
import {
  listIllustrations, getIllustration, createIllustration,
  renameIllustration, deleteIllustration
} from './illustrations'

function setup() {
  const db = openDb(':memory:')
  const book = createBook(db, { title: 'Tome 1' })
  return { db, book }
}

describe('db/illustrations', () => {
  it('crée et liste dans l\'ordre de position', () => {
    const { db, book } = setup()
    const a = createIllustration(db, book.id, 'ill-1-100-0.png', 'planche-1.png')
    const b = createIllustration(db, book.id, 'ill-1-100-1.png', 'planche-2.png')
    expect(a.position).toBe(1)
    expect(b.position).toBe(2)
    const list = listIllustrations(db, book.id)
    expect(list.map((i) => i.fileName)).toEqual(['ill-1-100-0.png', 'ill-1-100-1.png'])
    expect(list[0].bookId).toBe(book.id)
    expect(list[0].displayName).toBe('planche-1.png')
  })

  it('renomme et supprime', () => {
    const { db, book } = setup()
    const a = createIllustration(db, book.id, 'ill-1-100-0.png', 'planche-1.png')
    expect(renameIllustration(db, a.id, 'La maison').displayName).toBe('La maison')
    deleteIllustration(db, a.id)
    expect(listIllustrations(db, book.id)).toHaveLength(0)
    expect(() => getIllustration(db, a.id)).toThrow(/introuvable/)
  })

  it('la suppression du livre supprime ses illustrations (cascade)', () => {
    const { db, book } = setup()
    createIllustration(db, book.id, 'ill-1-100-0.png', 'p.png')
    db.prepare('DELETE FROM books WHERE id = ?').run(book.id)
    expect(db.prepare('SELECT COUNT(*) AS n FROM illustrations').get()).toEqual({ n: 0 })
  })
})
