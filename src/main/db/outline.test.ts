import { describe, it, expect, beforeEach } from 'vitest'
import { openDb, type Db } from './connection'
import { createBook } from './books'
import { createChapter } from './chapters'
import {
  listOutline,
  createOutlineNote,
  updateOutlineNote,
  reorderOutline,
  deleteOutlineNote
} from './outline'

let db: Db
let bookId: number
beforeEach(() => {
  db = openDb(':memory:')
  bookId = createBook(db, { title: 'Livre' }).id
})

describe('repository outline', () => {
  it('positions indépendantes par scope (global vs chapitre)', () => {
    const ch = createChapter(db, bookId, 'Ch. 1')
    const g1 = createOutlineNote(db, bookId, null)
    const c1 = createOutlineNote(db, bookId, ch.id)
    const g2 = createOutlineNote(db, bookId, null)
    expect(g1.position).toBe(1)
    expect(c1.position).toBe(1)
    expect(g2.position).toBe(2)
  })

  it('met à jour, réordonne dans un scope, supprime', () => {
    const a = createOutlineNote(db, bookId, null)
    const b = createOutlineNote(db, bookId, null)
    updateOutlineNote(db, a.id, 'Acte I')
    reorderOutline(db, bookId, null, [b.id, a.id])
    const notes = listOutline(db, bookId).filter((n) => n.chapterId === null)
    expect(notes.map((n) => n.id)).toEqual([b.id, a.id])
    expect(notes[1].content).toBe('Acte I')
    deleteOutlineNote(db, a.id)
    expect(listOutline(db, bookId)).toHaveLength(1)
  })
})
