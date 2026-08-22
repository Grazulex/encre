import { stripMarkdownFences } from './sanitizeFormatOutput'

export type ParseAiJsonResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string }

/**
 * Parse JSON défensif extrait d'une sortie IA structurée.
 *
 * Tolère:
 * - Les fences markdown (```json ... ```)
 * - Un préambule avant le premier [ ou {
 * - Du texte après le dernier ] ou } correspondant
 *
 * Ne jette jamais une exception.
 *
 * @param raw - Texte brut potentiellement contenant du JSON
 * @returns Résultat avec ok:true et la valeur parsée, ou ok:false et un message d'erreur en français
 */
export function parseAiJson<T>(raw: unknown): ParseAiJsonResult<T> {
  try {
    // Défense: accepter les entrées non-string sans jeter
    if (typeof raw !== 'string') {
      return { ok: false, error: 'Entrée non-string fournie à parseAiJson' }
    }

    // Étape 1: ôter les fences markdown
    const stripped = stripMarkdownFences(raw)
    const trimmed = stripped.trim()

    // Étape 2: chercher le premier caractère JSON plausible
    const openBracketIndex = trimmed.search(/[\[\{]/)
    if (openBracketIndex === -1) {
      return { ok: false, error: 'Aucun JSON trouvé (pas de [ ni {)' }
    }

    const openBracket = trimmed[openBracketIndex]
    const closeBracket = openBracket === '[' ? ']' : '}'

    // Étape 3: chercher le dernier ] ou } correspondant
    const closeBracketIndex = trimmed.lastIndexOf(closeBracket)
    if (closeBracketIndex === -1 || closeBracketIndex <= openBracketIndex) {
      return { ok: false, error: `Pas de ${closeBracket} correspondant trouvé` }
    }

    // Étape 4: extraire et parser le JSON
    const jsonString = trimmed.substring(openBracketIndex, closeBracketIndex + 1)

    let parsed: T
    try {
      parsed = JSON.parse(jsonString)
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e)
      return { ok: false, error: `JSON invalide: ${errorMsg}` }
    }

    return { ok: true, value: parsed }
  } catch (error) {
    // Défense absolue: capturer toute exception imprévue
    const errorMsg = error instanceof Error ? error.message : String(error)
    return { ok: false, error: `Erreur lors du parsing: ${errorMsg}` }
  }
}
