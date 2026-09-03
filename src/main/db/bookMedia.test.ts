import { describe, it, expect } from 'vitest'
import { openDb, type Db } from './connection'
import { createBook } from './books'
import type { Book } from '../../shared/types'
import {
  listBookMedia,
  getBookMedia,
  findBookMediaByRole,
  createBookMedia,
  updateBookMedia,
  deleteBookMedia
} from './bookMedia'

function setup(): { db: Db; book: Book } {
  const db = openDb(':memory:')
  const book = createBook(db, { title: 'Tome 1' })
  return { db, book }
}

describe('db/bookMedia', () => {
  it("crée et liste dans l'ordre de position", () => {
    const { db, book } = setup()
    const a = createBookMedia(db, book.id, 'couverture-epub', 'bm-1-100-0.png', 'cover.png')
    const b = createBookMedia(db, book.id, 'banniere', 'bm-1-100-1.jpg', 'promo.jpg')
    expect(a.position).toBe(1)
    expect(b.position).toBe(2)
    const list = listBookMedia(db, book.id)
    expect(list.map((m) => m.fileName)).toEqual(['bm-1-100-0.png', 'bm-1-100-1.jpg'])
    expect(list[0].bookId).toBe(book.id)
    expect(list[0].role).toBe('couverture-epub')
    expect(list[0].displayName).toBe('cover.png')
    // Valeurs par défaut de la table
    expect(list[0].note).toBe('')
    expect(typeof list[0].createdAt).toBe('string')
  })

  it('lit par id et lève si introuvable', () => {
    const { db, book } = setup()
    const a = createBookMedia(db, book.id, 'quatrieme', 'bm-1-100-0.png', 'dos.png')
    expect(getBookMedia(db, a.id).fileName).toBe('bm-1-100-0.png')
    expect(() => getBookMedia(db, a.id + 999)).toThrow(/introuvable/)
  })

  it('findBookMediaByRole trouve, renvoie null si absent, et rend le premier en cas de doublon', () => {
    const { db, book } = setup()
    const epub = createBookMedia(db, book.id, 'couverture-epub', 'bm-1-100-0.png', 'v1.png')
    createBookMedia(db, book.id, 'couverture-epub', 'bm-1-100-1.png', 'v2.png')
    createBookMedia(db, book.id, 'banniere', 'bm-1-100-2.png', 'promo.png')
    // deux médias partagent le rôle : le premier du magasin gagne
    expect(findBookMediaByRole(db, book.id, 'couverture-epub')?.id).toBe(epub.id)
    expect(findBookMediaByRole(db, book.id, 'couverture-epub')?.displayName).toBe('v1.png')
    expect(findBookMediaByRole(db, book.id, 'portrait-auteur')).toBeNull()
  })

  it("findBookMediaByRole ne déborde pas d'un livre à l'autre", () => {
    const { db, book } = setup()
    const autre = createBook(db, { title: 'Tome 2' })
    createBookMedia(db, book.id, 'couverture-epub', 'bm-1-100-0.png', 'cover.png')
    expect(findBookMediaByRole(db, autre.id, 'couverture-epub')).toBeNull()
  })

  it("updateBookMedia n'écrit que les champs du patch", () => {
    const { db, book } = setup()
    const m = createBookMedia(db, book.id, 'autre', 'bm-1-100-0.png', 'cover.png')

    const role = updateBookMedia(db, m.id, { role: 'couverture-broche' })
    expect(role.role).toBe('couverture-broche')
    expect(role.displayName).toBe('cover.png')
    expect(role.note).toBe('')

    const nom = updateBookMedia(db, m.id, { displayName: 'Couverture brochée v2' })
    expect(nom.displayName).toBe('Couverture brochée v2')
    expect(nom.role).toBe('couverture-broche')

    const note = updateBookMedia(db, m.id, { note: '15 x 21, dos 12 mm' })
    expect(note.note).toBe('15 x 21, dos 12 mm')
    expect(note.displayName).toBe('Couverture brochée v2')

    // patch vide : no-op, la ligne revient inchangée
    const inchange = updateBookMedia(db, m.id, {})
    expect(inchange).toEqual(note)

    // patch combiné
    const combine = updateBookMedia(db, m.id, {
      role: 'vignette',
      displayName: 'Vignette',
      note: '600 px'
    })
    expect(combine.role).toBe('vignette')
    expect(combine.displayName).toBe('Vignette')
    expect(combine.note).toBe('600 px')
    // la position et la date de création ne bougent jamais
    expect(combine.position).toBe(m.position)
    expect(combine.createdAt).toBe(m.createdAt)
  })

  it('supprime une ligne', () => {
    const { db, book } = setup()
    const a = createBookMedia(db, book.id, 'autre', 'bm-1-100-0.png', 'x.png')
    deleteBookMedia(db, a.id)
    expect(listBookMedia(db, book.id)).toHaveLength(0)
    expect(() => getBookMedia(db, a.id)).toThrow(/introuvable/)
  })

  it('la suppression du livre supprime ses médias (cascade)', () => {
    const { db, book } = setup()
    createBookMedia(db, book.id, 'couverture-epub', 'bm-1-100-0.png', 'cover.png')
    db.prepare('DELETE FROM books WHERE id = ?').run(book.id)
    expect(db.prepare('SELECT COUNT(*) AS n FROM book_media').get()).toEqual({ n: 0 })
  })
})
