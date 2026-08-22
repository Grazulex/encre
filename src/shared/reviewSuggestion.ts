// Validation défensive d'une suggestion de relecture (Task 3, plan 3c —
// correctif review) : parseAiJson (aiJson.ts) garantit un JSON syntaxiquement
// valide, mais ne garantit RIEN sur la FORME des éléments du tableau — un
// modèle peut omettre un champ, envoyer un `type` hors de l'énumération
// attendue, ou un champ du mauvais type. Sans ce filtre, un élément malformé
// traverserait tel quel jusqu'à ReviewPanel.vue / EditorPane.applySuggestionIntoEditor
// (ex. `quote` undefined → locateQuote plante sur `.indexOf` en TypeScript
// laxiste côté runtime, ou une valeur `type` inconnue affichée telle quelle).
// Posé en src/shared (pas dans stores/ai.ts) pour rester testable sous vitest
// (config limitée à src/main + src/shared).
import type { ReviewSuggestion } from './types'

const VALID_TYPES: ReadonlySet<string> = new Set([
  'repetition',
  'incoherence',
  'style',
  'orthographe'
])

/**
 * `true` si `value` a exactement la forme d'un `ReviewSuggestion` exploitable :
 * `type` parmi les 4 valeurs attendues, `quote` une chaîne NON VIDE (une
 * citation vide ne pourra jamais être localisée — `locateQuote` la rejette
 * déjà, autant l'écarter ici), `replacement` et `reason` des chaînes
 * (`replacement` peut légitimement être `''`, une suppression).
 */
export function isValidReviewSuggestion(value: unknown): value is ReviewSuggestion {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return (
    typeof v.type === 'string' &&
    VALID_TYPES.has(v.type) &&
    typeof v.quote === 'string' &&
    v.quote.length > 0 &&
    typeof v.replacement === 'string' &&
    typeof v.reason === 'string'
  )
}
