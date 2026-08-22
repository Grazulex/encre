import { describe, it, expect, beforeEach } from 'vitest'
import { openDb, type Db } from '../db/connection'
import { createBook } from '../db/books'
import { createChapter, saveChapterContent, saveChapterSummary } from '../db/chapters'
import { createEntity } from '../db/entities'
import { buildReviewPrompt } from './reviewContext'

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
        content: [{ type: 'text', text: 'Mara avança dans la rue. Mara avança encore.' }]
      }
    ]
  })
  saveChapterContent(db, chapterId, contentJson, 'Mara avança dans la rue. Mara avança encore.')
  saveChapterSummary(db, chapterId, 'Mara traverse la ville en direction de la tour de verre.')
})

describe('buildReviewPrompt', () => {
  it('system prompt : sortie JSON uniquement, quote mot pour mot, interdit la réécriture globale', () => {
    const { system } = buildReviewPrompt(db, chapterId)

    expect(system).toContain('JSON')
    expect(system).toContain('quote')
    expect(system).toMatch(/mot pour mot/i)
    expect(system).toMatch(/jamais.*réécriture globale|réécriture globale.*jamais/is)
  })

  it('system prompt : échoie les noms de champs et les valeurs de type autorisées', () => {
    const { system } = buildReviewPrompt(db, chapterId)

    expect(system).toContain('replacement')
    expect(system).toContain('reason')
    expect(system).toContain('repetition')
    expect(system).toContain('incoherence')
    expect(system).toContain('style')
    expect(system).toContain('orthographe')
  })

  it('system prompt : limite à une vingtaine de suggestions ciblées', () => {
    const { system } = buildReviewPrompt(db, chapterId)

    expect(system).toMatch(/20|vingtaine/i)
  })

  it('prompt : inclut le Markdown du chapitre et le résumé', () => {
    const { prompt } = buildReviewPrompt(db, chapterId)

    expect(prompt).toContain('Mara avança dans la rue.')
    expect(prompt).toContain('Mara traverse la ville en direction de la tour de verre.')
  })

  it('prompt : inclut le nom d\'une entité liée au chapitre via mentions', () => {
    const mara = createEntity(db, { bookId, kind: 'character', name: 'Mara' })
    const contentJsonWithMention = JSON.stringify({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'mention', attrs: { id: mara.id, label: 'Mara' } },
            { type: 'text', text: ' avança dans la rue.' }
          ]
        }
      ]
    })
    saveChapterContent(db, chapterId, contentJsonWithMention, 'Mara avança dans la rue.')

    const { prompt } = buildReviewPrompt(db, chapterId)
    expect(prompt).toContain('Mara')
  })

  it('prompt : sans entité liée, retombe sur la liste complète des fiches du livre', () => {
    createEntity(db, { bookId, kind: 'character', name: 'Solane' })

    const { prompt } = buildReviewPrompt(db, chapterId)
    expect(prompt).toContain('Solane')
  })

  it('rejette un chapitre inexistant', () => {
    expect(() => buildReviewPrompt(db, 9999)).toThrow()
  })
})
