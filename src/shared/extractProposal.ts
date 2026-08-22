// Validation défensive d'une proposition d'extraction de fiches (Task 5,
// plan 3c) : parseAiJson (aiJson.ts) garantit un JSON syntaxiquement valide,
// PAS la forme de l'objet ni celle de chacun de ses éléments — un modèle peut
// omettre un champ, envoyer un `kind` hors énumération, un `entityId` qui
// n'est pas un nombre, etc. Sans ce filtre, un élément malformé traverserait
// tel quel jusqu'à ExtractDialog.vue, où il planterait ou s'afficherait
// n'importe comment. Même esprit que reviewSuggestion.ts (sibling testable
// sous vitest, config limitée à src/main + src/shared), mais adapté à la
// forme d'ExtractProposal : UN SEUL objet avec deux tableaux (`creations` /
// `enrichissements`), pas un tableau au niveau racine.
//
// N'y figure PAS le filtre « entityId inconnu du livre » (un enrichissement
// dont l'entityId a la bonne forme — un nombre — mais ne correspond à aucune
// fiche existante) : ce filtre est posé côté renderer (stores/ai.ts), seul à
// connaître la liste courante des fiches du livre (useEntitiesStore). Ce
// module ne vérifie que la FORME, jamais l'existence en base.
import type { EntityKind, ExtractProposal } from './types'

const VALID_KINDS: ReadonlySet<string> = new Set<EntityKind>(['character', 'place'])

type ExtractCreation = ExtractProposal['creations'][number]
type ExtractEnrichissement = ExtractProposal['enrichissements'][number]

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

/**
 * `true` si `value` a exactement la forme d'une création exploitable : `kind`
 * parmi les 2 valeurs attendues, `name` une chaîne NON VIDE, `aliases` un
 * tableau de chaînes (peut être vide), `description` une chaîne (peut être
 * vide).
 */
export function isValidExtractCreation(value: unknown): value is ExtractCreation {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return (
    typeof v.kind === 'string' &&
    VALID_KINDS.has(v.kind) &&
    typeof v.name === 'string' &&
    v.name.trim().length > 0 &&
    isStringArray(v.aliases) &&
    typeof v.description === 'string'
  )
}

/**
 * `true` si `value` a exactement la forme d'un enrichissement exploitable :
 * `entityId` un nombre fini (l'existence réelle de cette fiche n'est PAS
 * vérifiée ici, voir en-tête de fichier), et chacun des trois champs
 * facultatifs (`aliases`/`description`/`notes`), s'il est présent, du bon
 * type.
 */
export function isValidExtractEnrichissement(value: unknown): value is ExtractEnrichissement {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  if (typeof v.entityId !== 'number' || !Number.isFinite(v.entityId)) return false
  if (v.aliases !== undefined && !isStringArray(v.aliases)) return false
  if (v.description !== undefined && typeof v.description !== 'string') return false
  if (v.notes !== undefined && typeof v.notes !== 'string') return false
  return true
}

export interface PairedEnrichissement<E extends { id: number }, F> {
  entity: E
  enrichissement: ExtractProposal['enrichissements'][number]
  fields: F[]
}

/**
 * Associe chaque enrichissement à SON entité et à SES champs exploitables,
 * en UN SEUL passage (une seule paire map+filtre, jamais deux tableaux
 * filtrés séparément puis recombinés par index).
 *
 * Régression évitée (Task 5, plan 3c — revue) : construire
 * `enrichissementChoices` avec un filtre (entité trouvée ET au moins un
 * champ exploitable) puis, à côté, `enrichissementSources` avec un filtre
 * DIFFÉRENT (entité trouvée seulement) désynchronise les deux tableaux dès
 * qu'un enrichissement a une entité connue mais aucun champ exploitable —
 * tout ce qui suit dans `enrichissementSources` se retrouve décalé d'un cran
 * par rapport à `enrichissementChoices`, et l'application finit par patcher
 * la MAUVAISE fiche avec les valeurs d'un autre enrichissement. En ne
 * produisant qu'UN SEUL tableau, où chaque élément porte directement son
 * entité, son enrichissement source et ses champs, ce genre de décalage est
 * structurellement impossible.
 *
 * `buildFields` est injecté (plutôt qu'un simple filtre alias/description/
 * notes non vides codé en dur ici) pour que la logique d'affichage
 * (libellés, aperçus — voir ExtractDialog.vue) reste côté composant ; ce
 * module ne connaît que la FORME générique du résultat.
 */
export function pairEnrichissementsWithEntities<E extends { id: number }, F>(
  enrichissements: ExtractProposal['enrichissements'],
  entities: readonly E[],
  buildFields: (enrichissement: ExtractProposal['enrichissements'][number]) => F[]
): PairedEnrichissement<E, F>[] {
  const paired: PairedEnrichissement<E, F>[] = []
  for (const enrichissement of enrichissements) {
    const entity = entities.find((e) => e.id === enrichissement.entityId)
    if (!entity) continue
    const fields = buildFields(enrichissement)
    if (fields.length === 0) continue
    paired.push({ entity, enrichissement, fields })
  }
  return paired
}

export interface FilteredExtractProposal {
  proposal: ExtractProposal
  malformedCount: number
}

/**
 * Valide la FORME d'un objet ExtractProposal brut (issu de parseAiJson) :
 * filtre chaque création/enrichissement individuellement (voir les deux
 * fonctions ci-dessus) et compte dans `malformedCount` ceux écartés.
 *
 * Retourne `null` si `value` n'a même pas la forme d'un objet exploitable —
 * pas un objet, ou `creations`/`enrichissements` absents/pas des tableaux —
 * distinct d'un objet valide dont les tableaux sont simplement vides (0
 * proposition, pas une réponse illisible).
 */
export function filterExtractProposal(value: unknown): FilteredExtractProposal | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const v = value as Record<string, unknown>
  if (!Array.isArray(v.creations) || !Array.isArray(v.enrichissements)) return null

  const creations = v.creations.filter(isValidExtractCreation)
  const enrichissements = v.enrichissements.filter(isValidExtractEnrichissement)
  const malformedCount =
    v.creations.length - creations.length + (v.enrichissements.length - enrichissements.length)

  return { proposal: { creations, enrichissements }, malformedCount }
}
