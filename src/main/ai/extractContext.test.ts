import { describe, it, expect, beforeEach } from 'vitest'
import { openDb, type Db } from '../db/connection'
import { createBook } from '../db/books'
import { createChapter, saveChapterContent } from '../db/chapters'
import { createEntity } from '../db/entities'
import { buildExtractPrompt } from './extractContext'

let db: Db
let bookId: number
let chapterId: number

beforeEach(() => {
  db = openDb(':memory:')
  const book = createBook(db, {
    title: 'Les Ombres de Verre',
    author: 'Jeanne Autrice',
    genre: 'Fantasy urbaine',
    synopsis: 'Une cité de verre.'
  })
  bookId = book.id
  const chapter = createChapter(db, book.id, 'Le Gardien de Verre')
  chapterId = chapter.id

  const contentJson = JSON.stringify({
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'Mara avança dans la rue, saluant Solane au passage.' }]
      }
    ]
  })
  saveChapterContent(
    db,
    chapterId,
    contentJson,
    'Mara avança dans la rue, saluant Solane au passage.'
  )
})

describe('buildExtractPrompt', () => {
  it('system prompt : sortie UN SEUL objet JSON ExtractProposal, champs recopiés mot pour mot', () => {
    const { system } = buildExtractPrompt(db, chapterId)

    expect(system).toContain('JSON')
    expect(system).toContain('creations')
    expect(system).toContain('enrichissements')
    expect(system).toContain('entityId')
    expect(system).toContain('aliases')
    expect(system).toContain('description')
    expect(system).toContain('notes')
    expect(system).toContain('character')
    expect(system).toContain('place')
  })

  it('system prompt : entityId doit être un id fourni, inventer un id est interdit', () => {
    const { system } = buildExtractPrompt(db, chapterId)

    expect(system).toMatch(/entityId.*(existant|fourni|liste)/is)
    expect(system).toMatch(/inventer.*interdit|interdit.*inventer/is)
  })

  it("system prompt : descriptions/notes sont des ajouts, jamais une réécriture de l'existant", () => {
    const { system } = buildExtractPrompt(db, chapterId)

    expect(system).toMatch(/ajout/i)
    expect(system).toMatch(/jamais.*réécriture|réécriture.*jamais/is)
  })

  it('system prompt : interdit les doublons dans creations (nom ou alias, insensible à la casse)', () => {
    const { system } = buildExtractPrompt(db, chapterId)

    expect(system).toMatch(/doublon/i)
    expect(system).toMatch(/casse/i)
  })

  it('system prompt : en français', () => {
    const { system } = buildExtractPrompt(db, chapterId)

    expect(system).toMatch(/français/i)
  })

  it('prompt : inclut le texte du chapitre', () => {
    const { prompt } = buildExtractPrompt(db, chapterId)

    expect(prompt).toContain('Mara avança dans la rue')
  })

  it("prompt : inclut nom, alias et id d'une entité existante du livre, même non liée au chapitre", () => {
    const solane = createEntity(db, { bookId, kind: 'character', name: 'Solane' })
    db.prepare('UPDATE entities SET aliases = ? WHERE id = ?').run(
      JSON.stringify(['La Voilée']),
      solane.id
    )

    const { prompt } = buildExtractPrompt(db, chapterId)
    expect(prompt).toContain('Solane')
    expect(prompt).toContain('La Voilée')
    expect(prompt).toContain(String(solane.id))
  })

  it('prompt : la liste des entités existantes est COMPLÈTE (pas seulement celles liées au chapitre)', () => {
    // Ni mentionnée ni liée au chapitre : doit quand même apparaître, contrairement
    // à buildReviewPrompt qui se limite aux entités liées quand il y en a.
    createEntity(db, { bookId, kind: 'place', name: 'La Tour Noire' })

    const { prompt } = buildExtractPrompt(db, chapterId)
    expect(prompt).toContain('La Tour Noire')
  })

  it('rejette un chapitre inexistant', () => {
    expect(() => buildExtractPrompt(db, 9999)).toThrow()
  })
})
