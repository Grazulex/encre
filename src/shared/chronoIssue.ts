// Validation défensive d'une incohérence de chronologie (Task 6, plan 3c) :
// parseAiJson (aiJson.ts) garantit un JSON syntaxiquement valide, PAS la
// forme de chaque élément du tableau — un modèle peut omettre un champ,
// envoyer une `severity` hors énumération, ou des ids qui ne sont pas des
// nombres. Sans ce filtre, un élément malformé traverserait tel quel jusqu'à
// ChronoReport.vue. Même esprit que reviewSuggestion.ts (sibling testable
// sous vitest, config limitée à src/main + src/shared).
//
// Second filtre, DISTINCT de la validation de forme ci-dessous : un
// chapterId/eventId bien formé (un nombre) peut malgré tout ne correspondre
// à AUCUN chapitre/événement du catalogue courant du livre (id inventé par
// le modèle malgré la consigne du system prompt, ou chapitre/événement
// supprimé entre le moment où le prompt a été construit et la fin du stream).
// filterChronoIssueIds ne rejette jamais l'incohérence entière pour autant —
// sa description reste exploitable même si un seul des ids qu'elle cite est
// caduc — elle se contente de retirer les ids inconnus des deux tableaux et
// de compter combien ont été retirés, pour affichage (« N id(s) ignoré(s) »).
import type { ChronoIssue } from './types'

const VALID_SEVERITIES: ReadonlySet<string> = new Set(['incoherence', 'doute'])

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'number' && Number.isFinite(item))
}

/**
 * `true` si `value` a exactement la forme d'un `ChronoIssue` exploitable :
 * `severity` parmi les 2 valeurs attendues, `description` une chaîne NON
 * VIDE (une incohérence sans description n'a rien à afficher), `chapterIds`
 * et `eventIds` des tableaux de nombres (peuvent être vides — une incohérence
 * peut ne porter que sur des chapitres, ou que sur des événements).
 */
export function isValidChronoIssue(value: unknown): value is ChronoIssue {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return (
    typeof v.severity === 'string' &&
    VALID_SEVERITIES.has(v.severity) &&
    typeof v.description === 'string' &&
    v.description.trim().length > 0 &&
    isNumberArray(v.chapterIds) &&
    isNumberArray(v.eventIds)
  )
}

export interface FilteredChronoIssue {
  issue: ChronoIssue
  removedIdCount: number
}

/**
 * Retire de `issue.chapterIds`/`issue.eventIds` les ids qui ne correspondent
 * à aucun chapitre/événement du catalogue courant (voir en-tête de fichier).
 * Ne connaît RIEN de Pinia/du renderer : `knownChapterIds`/`knownEventIds`
 * sont injectés par l'appelant (stores/ai.ts), ce qui garde cette fonction
 * testable sous vitest comme le reste de ce module.
 */
export function filterChronoIssueIds(
  issue: ChronoIssue,
  knownChapterIds: ReadonlySet<number>,
  knownEventIds: ReadonlySet<number>
): FilteredChronoIssue {
  const chapterIds = issue.chapterIds.filter((id) => knownChapterIds.has(id))
  const eventIds = issue.eventIds.filter((id) => knownEventIds.has(id))
  const removedIdCount =
    issue.chapterIds.length - chapterIds.length + (issue.eventIds.length - eventIds.length)
  return { issue: { ...issue, chapterIds, eventIds }, removedIdCount }
}
