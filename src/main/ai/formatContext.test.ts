import { describe, it, expect, beforeEach } from 'vitest'
import { openDb, type Db } from '../db/connection'
import { createBook } from '../db/books'
import { createChapter, saveChapterContent } from '../db/chapters'
import { buildFormatPrompt, type FormatConventions } from './formatContext'

let db: Db
let chapterId: number

beforeEach(() => {
  db = openDb(':memory:')
  const book = createBook(db, {
    title: 'Les Ombres de Verre',
    author: 'Jeanne Autrice',
    genre: 'Fantasy urbaine',
    synopsis: 'Une cité de verre.'
  })
  const chapter = createChapter(db, book.id, 'Le Gardien de Verre')
  chapterId = chapter.id

  const contentJson = JSON.stringify({
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text: '* Bonjour, dit-elle. * Elle avança.' }]
      },
      { type: 'sceneBreak' },
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'Un peu plus tard.' }]
      },
      { type: 'pageBreak' },
      {
        type: 'bulletList',
        content: [
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'un élément' }] }] }
        ]
      }
    ]
  })
  saveChapterContent(db, chapterId, contentJson, 'Bonjour, dit-elle. Elle avança. Un peu plus tard. un élément')
})

describe('buildFormatPrompt', () => {
  it('renvoie un system prompt de typographe qui interdit la réécriture', () => {
    const conventions: FormatConventions = { dialogue: 'guillemets', listes: 'tirets' }
    const { system } = buildFormatPrompt(db, chapterId, conventions)

    expect(system).toContain('typographe littéraire')
    expect(system).toContain('MÊME texte')
    expect(system).toMatch(/ne réécris? jamais/i)
    expect(system).toMatch(/Markdown/)
  })

  it('inclut le chapitre rendu en Markdown (avec *** et le commentaire page-break préservés)', () => {
    const conventions: FormatConventions = { dialogue: 'guillemets', listes: 'tirets' }
    const { prompt } = buildFormatPrompt(db, chapterId, conventions)

    expect(prompt).toContain('***')
    expect(prompt).toContain('<!-- page-break -->')
    expect(prompt).toContain('Un peu plus tard.')
  })

  it('demande explicitement de préserver *** et <!-- page-break --> tels quels', () => {
    const conventions: FormatConventions = { dialogue: 'guillemets', listes: 'tirets' }
    const { prompt } = buildFormatPrompt(db, chapterId, conventions)

    expect(prompt).toMatch(/préserv/i)
    expect(prompt.toLowerCase()).toContain('***')
  })

  it('convention dialogue = guillemets : exemple avec « … »', () => {
    const conventions: FormatConventions = { dialogue: 'guillemets', listes: 'tirets' }
    const { prompt } = buildFormatPrompt(db, chapterId, conventions)

    expect(prompt).toContain('« Bonjour »')
    expect(prompt).not.toContain('— Bonjour, dit-il.')
  })

  it('convention dialogue = tirets : exemple avec — cadratin', () => {
    const conventions: FormatConventions = { dialogue: 'tirets', listes: 'tirets' }
    const { prompt } = buildFormatPrompt(db, chapterId, conventions)

    expect(prompt).toContain('— Bonjour, dit-il.')
    expect(prompt).not.toContain('« Bonjour »')
  })

  it('convention listes = tirets : exemple avec "- élément"', () => {
    const conventions: FormatConventions = { dialogue: 'guillemets', listes: 'tirets' }
    const { prompt } = buildFormatPrompt(db, chapterId, conventions)

    expect(prompt).toContain('- élément')
  })

  it('convention listes = puces : exemple avec puce (pas de "- élément")', () => {
    const conventions: FormatConventions = { dialogue: 'guillemets', listes: 'puces' }
    const { prompt } = buildFormatPrompt(db, chapterId, conventions)

    expect(prompt).toMatch(/•\s*élément/)
  })

  it('liste les marqueurs de séparateur hétérogènes à convertir', () => {
    const conventions: FormatConventions = { dialogue: 'guillemets', listes: 'tirets' }
    const { prompt } = buildFormatPrompt(db, chapterId, conventions)

    expect(prompt).toContain('* * *')
    expect(prompt).toContain('•')
    expect(prompt).toContain('●')
    expect(prompt).toContain('~~~')
  })

  it('rejette une entrée sur un chapitre inexistant', () => {
    const conventions: FormatConventions = { dialogue: 'guillemets', listes: 'tirets' }
    expect(() => buildFormatPrompt(db, 9999, conventions)).toThrow()
  })
})
