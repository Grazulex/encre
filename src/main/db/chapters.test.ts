import { describe, it, expect, beforeEach } from 'vitest'
import { openDb, type Db } from './connection'
import { createBook } from './books'
import {
  countWords, listChapters, getChapter, createChapter,
  saveChapterContent, renameChapter, setChapterStatus,
  reorderChapters, deleteChapter
} from './chapters'

let db: Db
let bookId: number
beforeEach(() => {
  db = openDb(':memory:')
  bookId = createBook(db, { title: 'Livre test' }).id
})

describe('countWords', () => {
  it('compte les mots, robuste aux espaces', () => {
    expect(countWords('')).toBe(0)
    expect(countWords('   ')).toBe(0)
    expect(countWords('Un deux trois')).toBe(3)
    expect(countWords("L'aube  se\nlève")).toBe(3)
  })
})

describe('repository chapters', () => {
  it('crée des chapitres avec des positions croissantes', () => {
    const c1 = createChapter(db, bookId, 'Chapitre 1')
    const c2 = createChapter(db, bookId, 'Chapitre 2')
    expect(c1.position).toBe(1)
    expect(c2.position).toBe(2)
    expect(listChapters(db, bookId).map((c) => c.title)).toEqual(['Chapitre 1', 'Chapitre 2'])
  })

  it('sauvegarde le contenu et met à jour le compte de mots', () => {
    const c = createChapter(db, bookId, 'Chapitre 1')
    const json = JSON.stringify({ type: 'doc', content: [] })
    const { wordCount } = saveChapterContent(db, c.id, json, 'Il pleuvait sur Brest ce matin-là')
    expect(wordCount).toBe(6)
    const full = getChapter(db, c.id)
    expect(full.contentJson).toBe(json)
    expect(full.wordCount).toBe(6)
  })

  it('réordonne selon la liste fournie', () => {
    const a = createChapter(db, bookId, 'A')
    const b = createChapter(db, bookId, 'B')
    const c = createChapter(db, bookId, 'C')
    reorderChapters(db, bookId, [c.id, a.id, b.id])
    expect(listChapters(db, bookId).map((x) => x.title)).toEqual(['C', 'A', 'B'])
  })

  it('renomme, change le statut, supprime', () => {
    const c = createChapter(db, bookId, 'Ancien')
    renameChapter(db, c.id, 'Nouveau')
    setChapterStatus(db, c.id, 'premier_jet')
    const full = getChapter(db, c.id)
    expect(full.title).toBe('Nouveau')
    expect(full.status).toBe('premier_jet')
    deleteChapter(db, c.id)
    expect(listChapters(db, bookId)).toHaveLength(0)
  })
})
