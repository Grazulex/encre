import { describe, it, expect, beforeEach } from 'vitest'
import { openDb, type Db } from '../db/connection'
import { createBook, updateBook } from '../db/books'
import { getOrCreateSeries } from '../db/series'
import { createChapter, saveChapterContent, saveChapterSummary } from '../db/chapters'
import { createEntity, updateEntity } from '../db/entities'
import { createOutlineNote, updateOutlineNote } from '../db/outline'
import { createTimelineEvent, updateTimelineEvent, setTimelineLinks } from '../db/timeline'
import { buildWritePrompt, excerpt, tailExcerpt } from './context'

let db: Db
let bookId: number
let ch1Id: number
let ch2Id: number // chapitre cible (à écrire), avec résumé
let ch3Id: number // chapitre de référence, sans résumé
let ariaId: number
let citeId: number

function words(n: number, prefix = 'mot'): string {
  return Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`).join(' ')
}

beforeEach(() => {
  db = openDb(':memory:')
  const series = getOrCreateSeries(db, 'Les Chroniques de Verre')
  const book = createBook(db, {
    title: 'Les Ombres de Verre',
    author: 'Jeanne Autrice',
    genre: 'Fantasy urbaine',
    synopsis:
      'Dans une cité où le verre remplace la pierre, une adolescente découvre un pouvoir interdit.'
  })
  updateBook(db, book.id, { seriesId: series.id })
  bookId = book.id

  ariaId = createEntity(db, { bookId, kind: 'character', name: 'Aria' }).id
  updateEntity(db, ariaId, {
    aliases: ['la Verrière'],
    description: 'Une adolescente déterminée, capable de manipuler le verre.',
    attributes: { âge: '17', pouvoir: 'verre vivant' },
    notes: words(200, 'note')
  })
  citeId = createEntity(db, { bookId, kind: 'place', name: 'Cité de Verre' }).id
  updateEntity(db, citeId, { description: 'Une cité bâtie entièrement en verre soufflé.' })

  const c1 = createChapter(db, bookId, 'Le Départ')
  ch1Id = c1.id
  saveChapterSummary(db, ch1Id, 'Aria quitte sa ville natale après la mort de son père.')

  const c2 = createChapter(db, bookId, 'Le Gardien de Verre')
  ch2Id = c2.id
  saveChapterSummary(db, ch2Id, 'Aria affronte pour la première fois le gardien de verre.')
  const mentionJson = JSON.stringify({
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'mention', attrs: { id: ariaId, label: 'Aria' } },
          { type: 'mention', attrs: { id: citeId, label: 'Cité de Verre' } }
        ]
      }
    ]
  })
  saveChapterContent(db, ch2Id, mentionJson, 'Aria et Cité de Verre')

  const c3 = createChapter(db, bookId, "L'Aube Nouvelle")
  ch3Id = c3.id
  saveChapterContent(db, ch3Id, '{"type":"doc","content":[]}', words(200))

  const chapterNote = createOutlineNote(db, bookId, ch2Id)
  updateOutlineNote(db, chapterNote.id, 'Le combat doit rester bref et tendu.')
  const globalNote = createOutlineNote(db, bookId, null)
  updateOutlineNote(db, globalNote.id, 'Ton sombre et poétique tout au long du roman.')

  const linkedEvent = createTimelineEvent(db, bookId, 'Bataille du verre')
  updateTimelineEvent(db, linkedEvent.id, {
    dateLabel: 'Jour 3',
    description: 'Aria affronte le gardien devant toute la cité.'
  })
  setTimelineLinks(db, linkedEvent.id, [ch2Id], [ariaId])

  const otherEvent = createTimelineEvent(db, bookId, 'Naissance d’Aria')
  updateTimelineEvent(db, otherEvent.id, {
    dateLabel: 'Jour -6205',
    description: 'Aria naît à la Cité de Verre.'
  })
})

describe('excerpt', () => {
  it('laisse un texte court inchangé', () => {
    expect(excerpt('Un texte court.', 50)).toBe('Un texte court.')
  })

  it('tronque proprement sur une frontière de mot et ajoute … ', () => {
    const text = words(10)
    const result = excerpt(text, 3)
    expect(result).toBe('mot1 mot2 mot3 …')
  })

  it('ne coupe jamais un mot en deux', () => {
    const text = words(5)
    const result = excerpt(text, 3)
    expect(result.startsWith('mot1 mot2 mot3')).toBe(true)
    expect(result).not.toContain('mot4')
  })

  it('renvoie une chaîne vide pour un texte vide', () => {
    expect(excerpt('', 50)).toBe('')
  })

  it('texte court avec espaces multiples/internes : trim externe seulement, contenu inchangé', () => {
    const text = '  mot1   mot2\tmot3\n\nmot4  '
    // parts.length (4) <= maxWords (50) → branche "inchangé" : trim() seul, pas de collapse interne.
    expect(excerpt(text, 50)).toBe(text.trim())
  })

  it('normalise les espaces multiples/internes (split \\s+) quand la troncature a lieu', () => {
    const text = '  mot1   mot2\tmot3\n\nmot4  '
    expect(excerpt(text, 2)).toBe('mot1 mot2 …')
  })
})

describe('tailExcerpt', () => {
  it('laisse un texte court inchangé', () => {
    expect(tailExcerpt('Un texte court.', 50)).toBe('Un texte court.')
  })

  it('garde les N derniers mots et préfixe par … quand tronqué', () => {
    const text = words(10)
    const result = tailExcerpt(text, 3)
    expect(result).toBe('… mot8 mot9 mot10')
  })
})

describe('buildWritePrompt', () => {
  it('hasSummary = true et defaultEntityIds = mentions du chapitre', () => {
    const bundle = buildWritePrompt(db, ch2Id, {})
    expect(bundle.hasSummary).toBe(true)
    expect(bundle.defaultEntityIds.sort()).toEqual([ariaId, citeId].sort())
  })

  it('hasSummary = false pour un chapitre sans résumé', () => {
    const bundle = buildWritePrompt(db, ch3Id, {})
    expect(bundle.hasSummary).toBe(false)
  })

  it('inclut les 8 sections balisées avec le contenu attendu', () => {
    const bundle = buildWritePrompt(db, ch2Id, { instructions: 'Ajoute une touche de mystère.' })
    const p = bundle.prompt

    // 1. LIVRE
    expect(p).toContain('LIVRE')
    expect(p).toContain('Les Ombres de Verre')
    expect(p).toContain('Fantasy urbaine')
    expect(p).toContain('Dans une cité où le verre remplace la pierre')

    // 2. RÉSUMÉ DU CHAPITRE À ÉCRIRE
    expect(p).toContain('RÉSUMÉ DU CHAPITRE')
    expect(p).toContain('Aria affronte pour la première fois le gardien de verre.')
    expect(p).toContain('Le combat doit rester bref et tendu.')

    // 3. CHAPITRES DE RÉFÉRENCE
    expect(p).toContain('CHAPITRES DE RÉFÉRENCE')
    expect(p).toContain('Aria quitte sa ville natale après la mort de son père.')
    expect(p).toContain('← À ÉCRIRE')
    // ch3 n'a pas de résumé -> fallback sur excerpt(contentText, 120)
    expect(p).toContain('mot1 mot2')
    expect(p).toContain('…')

    // 4. PERSONNAGES ET LIEUX
    expect(p).toContain('PERSONNAGES ET LIEUX')
    expect(p).toContain('Aria')
    expect(p).toContain('la Verrière')
    expect(p).toContain('Cité de Verre')
    expect(p).toContain('âge')
    expect(p).toContain('note1 note2')

    // 5. CHRONOLOGIE
    expect(p).toContain('CHRONOLOGIE')
    expect(p).toContain('Bataille du verre')
    expect(p).toContain('(ce chapitre)')
    // l'événement non lié ne doit pas porter le marqueur juste après lui
    expect(p).toContain('Naissance')

    // 6. PLAN GÉNÉRAL
    expect(p).toContain('PLAN GÉNÉRAL')
    expect(p).toContain('Ton sombre et poétique')

    // 8. CONSIGNE
    expect(p).toContain('CONSIGNE')
    expect(p).toContain('Ajoute une touche de mystère.')

    // pas de section 7 sans continueFromText
    expect(p).not.toContain('TEXTE EXISTANT')
  })

  it('mode continuer ajoute la section TEXTE EXISTANT avec la fin du texte', () => {
    const longText = words(2500, 'phrase')
    saveChapterContent(db, ch2Id, '{"type":"doc","content":[]}', longText)
    const bundle = buildWritePrompt(db, ch2Id, { continueFromText: true })
    expect(bundle.prompt).toContain('TEXTE EXISTANT')
    expect(bundle.prompt).toContain('phrase2500')
    expect(bundle.prompt).not.toContain('phrase1 ')
  })

  it("mode continuer sans texte existant (contentText vide) n'ajoute pas la section TEXTE EXISTANT", () => {
    saveChapterContent(db, ch2Id, '{"type":"doc","content":[]}', '')
    const bundle = buildWritePrompt(db, ch2Id, { continueFromText: true })
    expect(bundle.prompt).not.toContain('TEXTE EXISTANT')
  })

  it('respecte une sélection explicite de entityIds', () => {
    const bundle = buildWritePrompt(db, ch2Id, { entityIds: [citeId] })
    expect(bundle.prompt).toContain('Cité de Verre')
    expect(bundle.prompt).not.toContain('la Verrière')
  })

  it('system présente le rôle de co-écrivain et les contraintes de sortie', () => {
    const bundle = buildWritePrompt(db, ch2Id, {})
    expect(bundle.system).toContain('co-écrivain')
    expect(bundle.system).toContain('français')
  })
})
