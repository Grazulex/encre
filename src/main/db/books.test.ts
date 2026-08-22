import { describe, it, expect, beforeEach } from 'vitest'
import { openDb, type Db } from './connection'
import { listBooks, getBook, createBook, updateBook, deleteBook } from './books'

let db: Db
beforeEach(() => {
  db = openDb(':memory:')
})

describe('repository books', () => {
  it('crée puis liste un livre avec les valeurs par défaut', () => {
    const book = createBook(db, { title: 'Mon roman' })
    expect(book.id).toBeGreaterThan(0)
    expect(book.status).toBe('en_cours')
    expect(book.language).toBe('fr')
    expect(book.wordCount).toBe(0)
    expect(book.chapterCount).toBe(0)

    const all = listBooks(db)
    expect(all).toHaveLength(1)
    expect(all[0].title).toBe('Mon roman')
  })

  it('met à jour les champs autorisés', () => {
    const book = createBook(db, { title: 'Brouillon' })
    const updated = updateBook(db, book.id, { title: 'Titre final', status: 'termine', wordGoal: 80000 })
    expect(updated.title).toBe('Titre final')
    expect(updated.status).toBe('termine')
    expect(updated.wordGoal).toBe(80000)
  })

  it('supprime un livre', () => {
    const book = createBook(db, { title: 'À jeter' })
    deleteBook(db, book.id)
    expect(listBooks(db)).toHaveLength(0)
    expect(() => getBook(db, book.id)).toThrow()
  })
})
