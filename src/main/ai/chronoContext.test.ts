import { describe, it, expect, beforeEach } from 'vitest'
import { openDb, type Db } from '../db/connection'
import { createBook } from '../db/books'
import { createChapter, saveChapterSummary } from '../db/chapters'
import { createEntity } from '../db/entities'
import { createTimelineEvent, updateTimelineEvent, setTimelineLinks } from '../db/timeline'
import { createOutlineNote, updateOutlineNote } from '../db/outline'
import { buildChronoPrompt } from './chronoContext'

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
  saveChapterSummary(db, chapterId, 'Mara découvre la tour de verre au printemps.')
})

describe('buildChronoPrompt', () => {
  it('rejette un livre sans chapitre', () => {
    const empty = createBook(db, { title: 'Livre vide' })
    expect(() => buildChronoPrompt(db, empty.id)).toThrow("Ce livre n'a aucun chapitre.")
  })

  it('rejette un livre inexistant', () => {
    expect(() => buildChronoPrompt(db, 9999)).toThrow()
  })

  it('prompt : inclut le résumé, la position et l’id du chapitre', () => {
    const { prompt } = buildChronoPrompt(db, bookId)

    expect(prompt).toContain('Mara découvre la tour de verre au printemps.')
    expect(prompt).toContain(`id ${chapterId}`)
    expect(prompt).toContain('position 1')
    expect(prompt).toContain('Le Gardien de Verre')
  })

  it('prompt : liste un chapitre sans résumé avec la mention « (pas de résumé) »', () => {
    const chapter2 = createChapter(db, bookId, 'Chapitre sans résumé')

    const { prompt } = buildChronoPrompt(db, bookId)

    expect(prompt).toContain(`id ${chapter2.id}`)
    expect(prompt).toContain('(pas de résumé)')
  })

  it('prompt : inclut les événements de chronologie avec id, date_label et liens', () => {
    const event = createTimelineEvent(db, bookId, 'Incendie de la tour')
    updateTimelineEvent(db, event.id, {
      dateLabel: 'Printemps an 3',
      description: 'La tour brûle.'
    })
    const mara = createEntity(db, { bookId, kind: 'character', name: 'Mara' })
    setTimelineLinks(db, event.id, [chapterId], [mara.id])

    const { prompt } = buildChronoPrompt(db, bookId)

    expect(prompt).toContain(`id ${event.id}`)
    expect(prompt).toContain('Printemps an 3')
    expect(prompt).toContain('Incendie de la tour')
    expect(prompt).toContain('La tour brûle.')
    expect(prompt).toContain(String(chapterId))
    expect(prompt).toContain(String(mara.id))
  })

  it('prompt : inclut le plan (outline)', () => {
    const note = createOutlineNote(db, bookId, chapterId)
    updateOutlineNote(db, note.id, 'Scène clé : la découverte de la tour.')

    const { prompt } = buildChronoPrompt(db, bookId)

    expect(prompt).toContain('Scène clé : la découverte de la tour.')
  })

  it('prompt : liste les entités par nom et type, pas de fiche complète', () => {
    createEntity(db, { bookId, kind: 'place', name: 'Verrenne' })

    const { prompt } = buildChronoPrompt(db, bookId)

    expect(prompt).toContain('Verrenne')
    expect(prompt).toContain('Lieu')
  })

  it("prompt : n'inclut jamais le texte intégral d'un chapitre", () => {
    // saveChapterContent n'est jamais appelé ici sur un contenu distinctif :
    // on vérifie plutôt que buildChronoPrompt ne lit pas contentText en
    // s'assurant qu'aucun bloc "## CHAPITRE (Markdown)" (utilisé par les
    // prompts par chapitre) n'apparaît dans ce prompt niveau livre.
    const { prompt } = buildChronoPrompt(db, bookId)
    expect(prompt).not.toContain('## CHAPITRE (Markdown)')
  })

  it('system prompt : exige des ids fournis, interdit d’en inventer, autorise le tableau vide', () => {
    const { system } = buildChronoPrompt(db, bookId)

    expect(system).toContain('JSON')
    expect(system).toMatch(/jamais.*id|id.*jamais/is)
    expect(system).toMatch(/vide/i)
    expect(system).toContain('severity')
    expect(system).toContain('incoherence')
    expect(system).toContain('doute')
    expect(system).toContain('chapterIds')
    expect(system).toContain('eventIds')
  })

  it('system prompt : instruit de signaler les chapitres sans résumé comme limite, jamais d’en inventer le contenu', () => {
    const { system } = buildChronoPrompt(db, bookId)

    expect(system).toMatch(/pas de résumé/i)
    expect(system).toMatch(/jamais.*invente|invente.*jamais/is)
  })
})
