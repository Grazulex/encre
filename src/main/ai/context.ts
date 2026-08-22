import type { Db } from '../db/connection'
import { getBook } from '../db/books'
import { getChapter, listChapters, entitiesInChapter } from '../db/chapters'
import { getEntity } from '../db/entities'
import { listOutline } from '../db/outline'
import { listTimeline } from '../db/timeline'
import type { Entity } from '../../shared/types'

export interface WriteOptions {
  instructions?: string // consigne libre de l'auteur
  entityIds?: number[] // sélection de fiches ; défaut = entitiesInChapter(chapterId)
  continueFromText?: boolean // true si le chapitre a déjà du texte : mode « continuer »
}

export interface WritePromptBundle {
  system: string
  prompt: string
  defaultEntityIds: number[] // ce que l'UI pré-coche
  hasSummary: boolean // false → l'UI bloque
}

const TAIL_WORD_COUNT = 2000

const SYSTEM_PROMPT =
  "Tu es le co-écrivain du roman dont le contexte t'est fourni ci-dessous. " +
  'Tu écris en français, dans la voix du texte existant. ' +
  'Tu rends UNIQUEMENT le texte du chapitre (pas de titre, pas de commentaire, pas de balises), ' +
  'en paragraphes séparés par des lignes vides. ' +
  'Respecte scrupuleusement les fiches et la chronologie fournies.'

/** Tronque proprement un texte à `maxWords` mots (frontière de mot), suffixé de ' …' si tronqué. */
export function excerpt(text: string, maxWords: number): string {
  const trimmed = text.trim()
  if (!trimmed) return ''
  const parts = trimmed.split(/\s+/)
  if (parts.length <= maxWords) return trimmed
  return `${parts.slice(0, maxWords).join(' ')} …`
}

/** Garde les `maxWords` derniers mots d'un texte, préfixés de '… ' si tronqué. */
export function tailExcerpt(text: string, maxWords: number): string {
  const trimmed = text.trim()
  if (!trimmed) return ''
  const parts = trimmed.split(/\s+/)
  if (parts.length <= maxWords) return trimmed
  return `… ${parts.slice(parts.length - maxWords).join(' ')}`
}

const KIND_LABELS: Record<string, string> = {
  character: 'Personnage',
  place: 'Lieu'
}

function formatEntity(entity: Entity): string {
  const lines: string[] = [`### ${entity.name} (${KIND_LABELS[entity.kind] ?? entity.kind})`]
  if (entity.aliases.length > 0) lines.push(`Alias : ${entity.aliases.join(', ')}`)
  if (entity.description.trim()) lines.push(`Description : ${entity.description.trim()}`)
  const attrEntries = Object.entries(entity.attributes)
  if (attrEntries.length > 0) {
    lines.push('Attributs :')
    for (const [key, value] of attrEntries) lines.push(`- ${key}: ${value}`)
  }
  if (entity.notes.trim()) lines.push(`Notes : ${excerpt(entity.notes, 150)}`)
  return lines.join('\n')
}

export function buildWritePrompt(db: Db, chapterId: number, options: WriteOptions): WritePromptBundle {
  const chapter = getChapter(db, chapterId)
  const book = getBook(db, chapter.bookId)
  const allChapters = listChapters(db, book.id)
  const outlineNotes = listOutline(db, book.id)
  const timelineEvents = listTimeline(db, book.id)
  const defaultEntityIds = entitiesInChapter(db, chapterId).map((e) => e.id)
  const entityIds = options.entityIds ?? defaultEntityIds
  const hasSummary = chapter.summary.trim().length > 0

  const sections: string[] = []

  // 1. LIVRE
  const livreLines = [
    `Titre : ${book.title}`,
    `Genre : ${book.genre}`,
    ...(book.author.trim() ? [`Auteur : ${book.author}`] : []),
    ...(book.seriesName ? [`Série : ${book.seriesName}`] : []),
    `Synopsis : ${book.synopsis}`
  ]
  sections.push(['## LIVRE', ...livreLines].join('\n'))

  // 2. RÉSUMÉ DU CHAPITRE À ÉCRIRE
  const chapterNotes = outlineNotes.filter((n) => n.chapterId === chapterId)
  const resumeLines = [hasSummary ? chapter.summary.trim() : 'Aucun résumé fourni pour ce chapitre.']
  if (chapterNotes.length > 0) {
    resumeLines.push('', 'Notes de plan :')
    for (const note of chapterNotes) resumeLines.push(`- ${note.content}`)
  }
  sections.push(['## RÉSUMÉ DU CHAPITRE À ÉCRIRE', ...resumeLines].join('\n'))

  // 3. CHAPITRES DE RÉFÉRENCE
  const refLines = allChapters.map((meta) => {
    const isTarget = meta.id === chapterId
    const full = getChapter(db, meta.id)
    const resume = full.summary.trim() ? full.summary.trim() : excerpt(full.contentText, 120)
    const marker = isTarget ? ' ← À ÉCRIRE' : ''
    return `Chapitre ${meta.position} — ${meta.title} : ${resume}${marker}`
  })
  sections.push(['## CHAPITRES DE RÉFÉRENCE', ...refLines].join('\n'))

  // 4. PERSONNAGES ET LIEUX
  const entityBlocks = entityIds.map((id) => formatEntity(getEntity(db, id)))
  sections.push(['## PERSONNAGES ET LIEUX', ...entityBlocks].join('\n\n'))

  // 5. CHRONOLOGIE
  const timelineLines = timelineEvents.map((event) => {
    const marker = event.chapterIds.includes(chapterId) ? ' (ce chapitre)' : ''
    return `${event.dateLabel} — ${event.title} : ${event.description}${marker}`
  })
  sections.push(['## CHRONOLOGIE', ...timelineLines].join('\n'))

  // 6. PLAN GÉNÉRAL
  const globalNotes = outlineNotes.filter((n) => n.chapterId === null)
  const planLines = globalNotes.length > 0 ? globalNotes.map((n) => `- ${n.content}`) : ['(aucune note globale)']
  sections.push(['## PLAN GÉNÉRAL', ...planLines].join('\n'))

  // 7. TEXTE EXISTANT (si continueFromText)
  if (options.continueFromText && chapter.contentText.trim()) {
    sections.push(
      [
        '## TEXTE EXISTANT',
        tailExcerpt(chapter.contentText, TAIL_WORD_COUNT),
        '',
        'Consigne : continue directement la suite de ce texte, sans répéter ce qui précède.'
      ].join('\n')
    )
  }

  // 8. CONSIGNE
  if (options.instructions && options.instructions.trim()) {
    sections.push(['## CONSIGNE', options.instructions.trim()].join('\n'))
  }

  const prompt = sections.join('\n\n')

  return { system: SYSTEM_PROMPT, prompt, defaultEntityIds, hasSummary }
}
