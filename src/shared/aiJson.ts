import { stripMarkdownFences } from './sanitizeFormatOutput'

export type ParseAiJsonResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string }

/**
 * Parse JSON défensif extrait d'une sortie IA structurée.
 *
 * Tolère:
 * - Les fences markdown (```json ... ```)
 * - Un préambule contenant des crochets avant le JSON (ex: "Voici [enfin] le résultat : {...}")
 * - Plusieurs candidats de crochets ouvrants (boucle jusqu'à 10 candidats)
 *
 * Ne jette jamais une exception.
 *
 * @param raw - Texte brut potentiellement contenant du JSON
 * @returns Résultat avec ok:true et la valeur parsée, ou ok:false et un message d'erreur en français
 */
export function parseAiJson<T>(raw: string): ParseAiJsonResult<T> {
  try {
    // Défense interne: accepter les entrées non-string sans jeter
    if (typeof raw !== 'string') {
      return { ok: false, error: 'Entrée non-string fournie à parseAiJson' }
    }

    // Étape 1: ôter les fences markdown
    const stripped = stripMarkdownFences(raw)
    const trimmed = stripped.trim()

    // Étape 2: essayer successivement les candidats [ ou {
    const MAX_CANDIDATES = 10
    let searchStartIndex = 0

    for (let attemptCount = 0; attemptCount < MAX_CANDIDATES; attemptCount++) {
      // Trouver le prochain [ ou { à partir de searchStartIndex
      const remainingText = trimmed.slice(searchStartIndex)
      const nextMatch = remainingText.search(/[\[\{]/)

      if (nextMatch === -1) {
        // Pas de JSON trouvé
        if (attemptCount === 0) {
          return { ok: false, error: 'Aucun JSON trouvé (pas de [ ni {)' }
        }
        // Tous les candidats ont échoué
        return { ok: false, error: 'Aucun JSON valide trouvé après avoir testé les candidats' }
      }

      const actualOpenBracketIndex = searchStartIndex + nextMatch
      const openBracket = trimmed[actualOpenBracketIndex]
      const closeBracket = openBracket === '[' ? ']' : '}'

      // Étape 3: chercher le dernier ] ou } de ce type
      const closeBracketIndex = trimmed.lastIndexOf(closeBracket)
      if (closeBracketIndex === -1 || closeBracketIndex <= actualOpenBracketIndex) {
        // Ce candidat n'a pas de fermeture, essayer le suivant
        searchStartIndex = actualOpenBracketIndex + 1
        continue
      }

      // Étape 4: extraire et parser le JSON
      const jsonString = trimmed.substring(actualOpenBracketIndex, closeBracketIndex + 1)

      try {
        const parsed: T = JSON.parse(jsonString)
        return { ok: true, value: parsed }
      } catch {
        // Ce candidat ne parse pas, essayer le suivant
        searchStartIndex = actualOpenBracketIndex + 1
        continue
      }
    }

    // Trop de candidats, on abandonne
    return { ok: false, error: 'Trop de candidats de crochets sans JSON valide' }
  } catch (error) {
    // Défense absolue: capturer toute exception imprévue
    const errorMsg = error instanceof Error ? error.message : String(error)
    return { ok: false, error: `Erreur lors du parsing: ${errorMsg}` }
  }
}
