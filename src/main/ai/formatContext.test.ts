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
    const conventions: FormatConventions = { dialogue: 'guillemets', listes: 'tirets', proposerSeparations: false }
    const { system } = buildFormatPrompt(db, chapterId, conventions)

    expect(system).toContain('typographe littéraire')
    expect(system).toContain('MÊME texte')
    expect(system).toMatch(/ne réécris? jamais/i)
    expect(system).toMatch(/Markdown/)
  })

  it('proposerSeparations = false : system prompt strictement identique au system prompt historique (aucune dérive)', () => {
    const conventions: FormatConventions = { dialogue: 'guillemets', listes: 'tirets', proposerSeparations: false }
    const { system } = buildFormatPrompt(db, chapterId, conventions)

    expect(system).toBe(
      "Tu es typographe littéraire. On te donne le texte d'un chapitre en Markdown. " +
        'Tu rends le MÊME texte, mots et ponctuation du récit inchangés, en normalisant ' +
        'UNIQUEMENT la mise en forme selon les conventions demandées : dialogues, listes, ' +
        'séparateurs de scène (uniquement la ligne `***`), et rien d\'autre. ' +
        'Tu ne réécris JAMAIS une phrase, tu ne corriges pas le style, ' +
        "tu n'ajoutes ni ne retires de contenu. " +
        'Sortie : le Markdown complet du chapitre, rien d\'autre.'
    )
  })

  it('proposerSeparations = true : le system prompt autorise explicitement les insertions, sans perdre la garantie anti-réécriture', () => {
    const conventions: FormatConventions = { dialogue: 'guillemets', listes: 'tirets', proposerSeparations: true }
    const { system } = buildFormatPrompt(db, chapterId, conventions)

    expect(system).toMatch(/ne réécris? jamais/i)
    expect(system).toMatch(/exception/i)
    expect(system).toMatch(/PEUX aussi INSÉRER/i)
    expect(system).toContain('***')
    expect(system).toContain('<!-- page-break -->')
  })

  it("demande une sortie sans préambule ni recopie du titre CHAPITRE", () => {
    const conventions: FormatConventions = { dialogue: 'guillemets', listes: 'tirets', proposerSeparations: false }
    const { prompt } = buildFormatPrompt(db, chapterId, conventions)

    expect(prompt).toMatch(/directement à sa toute première ligne/i)
    expect(prompt).toMatch(/ne recopie pas le titre/i)
  })

  it('inclut le chapitre rendu en Markdown (avec *** et le commentaire page-break préservés)', () => {
    const conventions: FormatConventions = { dialogue: 'guillemets', listes: 'tirets', proposerSeparations: false }
    const { prompt } = buildFormatPrompt(db, chapterId, conventions)

    expect(prompt).toContain('***')
    expect(prompt).toContain('<!-- page-break -->')
    expect(prompt).toContain('Un peu plus tard.')
  })

  it('demande explicitement de préserver *** et <!-- page-break --> tels quels', () => {
    const conventions: FormatConventions = { dialogue: 'guillemets', listes: 'tirets', proposerSeparations: false }
    const { prompt } = buildFormatPrompt(db, chapterId, conventions)

    expect(prompt).toMatch(/préserv/i)
    expect(prompt.toLowerCase()).toContain('***')
  })

  it('convention dialogue = guillemets : exemple avec « … »', () => {
    const conventions: FormatConventions = { dialogue: 'guillemets', listes: 'tirets', proposerSeparations: false }
    const { prompt } = buildFormatPrompt(db, chapterId, conventions)

    expect(prompt).toContain('« Bonjour »')
    expect(prompt).not.toContain('— Bonjour, dit-il.')
  })

  it('convention dialogue = tirets : exemple avec — cadratin', () => {
    const conventions: FormatConventions = { dialogue: 'tirets', listes: 'tirets', proposerSeparations: false }
    const { prompt } = buildFormatPrompt(db, chapterId, conventions)

    expect(prompt).toContain('— Bonjour, dit-il.')
    expect(prompt).not.toContain('« Bonjour »')
  })

  it('convention listes = tirets : exemple avec "- élément"', () => {
    const conventions: FormatConventions = { dialogue: 'guillemets', listes: 'tirets', proposerSeparations: false }
    const { prompt } = buildFormatPrompt(db, chapterId, conventions)

    expect(prompt).toContain('- élément')
  })

  it('convention listes = puces : exemple avec puce (pas de "- élément")', () => {
    const conventions: FormatConventions = { dialogue: 'guillemets', listes: 'puces', proposerSeparations: false }
    const { prompt } = buildFormatPrompt(db, chapterId, conventions)

    expect(prompt).toMatch(/•\s*élément/)
  })

  it('liste les marqueurs de séparateur hétérogènes à convertir', () => {
    const conventions: FormatConventions = { dialogue: 'guillemets', listes: 'tirets', proposerSeparations: false }
    const { prompt } = buildFormatPrompt(db, chapterId, conventions)

    expect(prompt).toContain('* * *')
    expect(prompt).toContain('•')
    expect(prompt).toContain('●')
    expect(prompt).toContain('~~~')
  })

  it('rejette une entrée sur un chapitre inexistant', () => {
    const conventions: FormatConventions = { dialogue: 'guillemets', listes: 'tirets', proposerSeparations: false }
    expect(() => buildFormatPrompt(db, 9999, conventions)).toThrow()
  })

  it('proposerSeparations = false : pas d\'instruction de proposition, préservation stricte conservée', () => {
    const conventions: FormatConventions = { dialogue: 'guillemets', listes: 'tirets', proposerSeparations: false }
    const { prompt } = buildFormatPrompt(db, chapterId, conventions)

    expect(prompt).not.toMatch(/propos/i)
    expect(prompt).toMatch(/préserve-les\s+exactement/i)
    expect(prompt).toMatch(/sans les modifier, déplacer ni supprimer/i)
  })

  it('proposerSeparations = true : instruction de proposition présente (transitions, jamais retirer)', () => {
    const conventions: FormatConventions = { dialogue: 'guillemets', listes: 'tirets', proposerSeparations: true }
    const { prompt } = buildFormatPrompt(db, chapterId, conventions)

    expect(prompt).toMatch(/propos/i)
    expect(prompt).toMatch(/transition/i)
    expect(prompt).toMatch(/jamais\s+(en\s+)?retirer/i)
    expect(prompt).toContain('***')
    expect(prompt).toContain('<!-- page-break -->')
  })
})
