import { describe, it, expect, beforeEach } from 'vitest'
import { openDb, type Db } from './connection'
import { createBook } from './books'
import { getBook } from './books'
import { createEntity } from './entities'
import {
  countWords,
  listChapters,
  listChapterSummaries,
  getChapter,
  createChapter,
  saveChapterContent,
  renameChapter,
  setChapterStatus,
  setChapterGoal,
  searchInBook,
  reorderChapters,
  deleteChapter,
  entityOccurrences,
  entitiesInChapter,
  saveChapterSummary
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

  it('recherche plein texte, insensible à la casse et aux accents', () => {
    const c1 = createChapter(db, bookId, 'Ouverture')
    saveChapterContent(db, c1.id, 'Ia', 'Il était une fois Brest.')
    const c2 = createChapter(db, bookId, 'Suite')
    saveChapterContent(db, c2.id, 'Ib', 'Une île lointaine où brétonnaient les Échos.')
    const c3 = createChapter(db, bookId, 'Autre')
    saveChapterContent(db, c3.id, 'Ic', 'Sans rapport.')

    const hits = searchInBook(db, bookId, 'brETONNAient')
    expect(hits).toHaveLength(1)
    expect(hits[0].chapterId).toBe(c2.id)
    expect(hits[0].snippet.match).toBe('brétonnaient')
    // la requête vide ne renvoie rien
    expect(searchInBook(db, bookId, '  ')).toEqual([])
  })

  it('searchInBook : retourne un snippet autour de la première occurrence', () => {
    const c = createChapter(db, bookId, 'Ch. 1')
    saveChapterContent(db, c.id, '{}', 'xxxxx AAA yyyyy')
    const hits = searchInBook(db, bookId, 'aaa')
    expect(hits[0].snippet.match).toBe('AAA')
    expect(hits[0].snippet.before.endsWith('xxxxx ')).toBe(true)
    expect(hits[0].snippet.after.startsWith(' yyyyy')).toBe(true)
  })

  it('enregistre le résumé manuel', () => {
    const c = createChapter(db, bookId, 'Ch. 1')
    saveChapterSummary(db, c.id, 'Mara découvre la lettre.')
    expect(getChapter(db, c.id).summary).toBe('Mara découvre la lettre.')
  })

  it('met à jour l’objectif de mots du chapitre', () => {
    const c = createChapter(db, bookId, 'Ch. 1')
    expect(getChapter(db, c.id).wordGoal).toBeNull()
    setChapterGoal(db, c.id, 5000)
    expect(getChapter(db, c.id).wordGoal).toBe(5000)
    expect(listChapters(db, bookId)[0].wordGoal).toBe(5000)
    setChapterGoal(db, c.id, null)
    expect(getChapter(db, c.id).wordGoal).toBeNull()
  })

  it('listChapterSummaries : id, position, titre, résumé, dans l’ordre, sans le contenu', () => {
    const c1 = createChapter(db, bookId, 'Ch. 1')
    saveChapterSummary(db, c1.id, 'Résumé du premier.')
    const c2 = createChapter(db, bookId, 'Ch. 2')
    saveChapterContent(db, c2.id, '{"type":"doc","content":[]}', 'Un contenu quelconque')

    const summaries = listChapterSummaries(db, bookId)
    expect(summaries).toEqual([
      { id: c1.id, position: 1, title: 'Ch. 1', summary: 'Résumé du premier.' },
      { id: c2.id, position: 2, title: 'Ch. 2', summary: '' }
    ])
    expect(summaries[1]).not.toHaveProperty('contentJson')
    expect(summaries[1]).not.toHaveProperty('contentText')
  })
})

describe('mentions et occurrences', () => {
  it('synchronise la table mentions à la sauvegarde et bump le livre', () => {
    const mara = createEntity(db, { bookId, kind: 'character', name: 'Mara' })
    const c = createChapter(db, bookId, 'Ch. 1')
    const before = getBook(db, bookId).updatedAt
    const json = JSON.stringify({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'mention', attrs: { id: mara.id, label: 'Mara' } }] }
      ]
    })
    db.prepare("UPDATE books SET updated_at = '2000-01-01 00:00:00' WHERE id = ?").run(bookId)
    saveChapterContent(db, c.id, json, 'Mara')
    expect(entitiesInChapter(db, c.id).map((e) => e.name)).toEqual(['Mara'])
    expect(entityOccurrences(db, mara.id)).toEqual([
      { chapterId: c.id, chapterTitle: 'Ch. 1', chapterPosition: 1 }
    ])
    expect(getBook(db, bookId).updatedAt).not.toBe('2000-01-01 00:00:00')
    // retrait de la mention → index nettoyé
    saveChapterContent(db, c.id, '{"type":"doc","content":[]}', '')
    expect(entitiesInChapter(db, c.id)).toEqual([])
    void before
  })

  it('ignore les ids de mention qui ne correspondent à aucune entité', () => {
    const c = createChapter(db, bookId, 'Ch. 1')
    const json = JSON.stringify({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'mention', attrs: { id: 999, label: 'Fantôme' } }] }
      ]
    })
    expect(() => saveChapterContent(db, c.id, json, 'Fantôme')).not.toThrow()
    expect(entitiesInChapter(db, c.id)).toEqual([])
  })
})
