import type { Db } from '../db/connection'
import { getChapter } from '../db/chapters'
import { getBook } from '../db/books'
import { listEntities } from '../db/entities'
import { tiptapToMarkdown } from '../../shared/export'
import type { Entity } from '../../shared/types'
import type { FormatPromptBundle } from './formatContext'

// Réexporté pour ne pas forcer les consommateurs (extractContext.test.ts, api.ts)
// à importer FormatPromptBundle depuis formatContext.ts : les trois prompts
// (harmonisation, relecture, extraction) partagent la même forme { system, prompt }.
export type { FormatPromptBundle }

const KIND_LABELS: Record<string, string> = {
  character: 'Personnage',
  place: 'Lieu'
}

// Rendu d'une fiche pour la liste complète du livre (Task 4, plan 3c) : id
// EXPLICITE (le modèle doit le recopier tel quel dans enrichissements[].entityId,
// jamais en inventer un), name, aliases, description. Ni attributs ni notes ici
// — le brief ne demande que ces cinq champs (id, kind, name, aliases,
// description) pour rattacher/dédupliquer, pas une fiche complète comme dans
// buildWritePrompt/buildReviewPrompt.
function formatEntity(entity: Entity): string {
  const lines: string[] = [`### ${entity.name} (${KIND_LABELS[entity.kind] ?? entity.kind}, id ${entity.id})`]
  if (entity.aliases.length > 0) lines.push(`Alias : ${entity.aliases.join(', ')}`)
  lines.push(`Description : ${entity.description.trim() ? entity.description.trim() : '(aucune description)'}`)
  return lines.join('\n')
}

// System prompt d'extraction de fiches (Task 4, plan 3c) : contrat de sortie
// STRICT — UN SEUL objet JSON ExtractProposal (src/shared/types.ts), jamais un
// tableau, jamais de texte autour. Les noms de champs et les valeurs
// autorisées de `kind` sont recopiés mot pour mot pour que Claude ne les
// invente pas — même logique que SYSTEM_PROMPT_REVIEW dans reviewContext.ts.
//
// Deux garde-fous spécifiques à l'extraction (absents de la relecture) :
// - `enrichissements[].entityId` doit être un id RÉELLEMENT fourni dans la
//   liste des entités du prompt (inventer un id est interdit ; un id inconnu
//   sera de toute façon écarté côté renderer, donc autant l'exclure ici) ;
// - `creations` ne doit contenir AUCUN doublon d'une entité déjà existante,
//   le rattachement se faisant par nom OU alias, sans tenir compte de la casse
//   (une entité déjà listée sous un alias ne doit jamais réapparaître comme
//   nouvelle création sous ce même nom).
const SYSTEM_PROMPT_EXTRACT =
  "Tu es archiviste littéraire. On te donne le texte d'un chapitre en Markdown " +
  "et la liste complète des fiches personnages et lieux déjà existantes pour ce " +
  'livre (id, type, nom, alias, description). Tu repères dans ce chapitre les ' +
  'nouveaux personnages et lieux à créer, et les compléments à apporter aux ' +
  'fiches existantes. ' +
  'Sortie : UNIQUEMENT un seul objet JSON, sans aucun texte avant ni après, ' +
  "sans bloc de code Markdown (pas de ```), ayant EXACTEMENT ces champs : " +
  '`creations` (tableau d\'objets `{ kind, name, aliases, description }` où ' +
  '`kind` est une valeur parmi "character" ou "place" — jamais une autre ' +
  'valeur —, `aliases` un tableau de chaînes, `description` une chaîne) et ' +
  '`enrichissements` (tableau d\'objets `{ entityId, aliases, description, ' +
  "notes }` où `aliases`, `description` et `notes` sont optionnels). " +
  '`entityId` DOIT être un id existant, recopié tel quel depuis la liste des ' +
  "fiches fournie ci-dessous : inventer un id est INTERDIT, et un id qui ne " +
  'figure pas dans cette liste sera de toute façon ignoré. ' +
  '`description` et `notes` (dans `enrichissements`) sont des AJOUTS, jamais ' +
  'une réécriture : la fiche existante (description, attributs, notes) est ' +
  "fournie ci-dessous comme CONTEXTE pour éviter les redites, et tu n'y " +
  'apportes que des informations NOUVELLES et complémentaires, sans jamais ' +
  'recopier ni reformuler ce qui y figure déjà. ' +
  '`creations` ne doit JAMAIS comporter de doublon d\'une entité déjà ' +
  'existante : avant de proposer une création, vérifie que ni son nom ni ' +
  "aucun de ses alias ne correspond, même en ignorant la casse, au nom ou à " +
  "un alias d'une fiche déjà listée — dans ce cas, propose un enrichissement " +
  'de cette fiche existante plutôt qu\'une création. ' +
  'Réponds en français.'

/** Construit le prompt d'extraction de fiches (créations + enrichissements) pour un chapitre donné. */
export function buildExtractPrompt(db: Db, chapterId: number): FormatPromptBundle {
  const chapter = getChapter(db, chapterId)
  const book = getBook(db, chapter.bookId)
  const markdown = tiptapToMarkdown(chapter.contentJson)

  // Liste COMPLÈTE des entités du livre (brief, Task 4) — contrairement à
  // buildReviewPrompt qui se limite aux entités liées au chapitre courant : ici
  // le but est de rattacher/dédupliquer contre TOUT le catalogue du livre, pas
  // seulement ce qui apparaît déjà dans ce chapitre précis.
  const entityList = listEntities(db, book.id)
  const entityBlocks = entityList.map(formatEntity)

  const lines: string[] = [
    '## PERSONNAGES ET LIEUX EXISTANTS (liste complète du livre — pour rattacher et ne pas dupliquer)',
    entityBlocks.length > 0 ? entityBlocks.join('\n\n') : '(aucune fiche existante pour ce livre)',
    '',
    "Format de sortie : réponds UNIQUEMENT par l'objet JSON, sans phrase " +
      "d'introduction, sans commentaire, sans bloc de code Markdown.",
    '',
    '## CHAPITRE (Markdown)',
    '',
    markdown
  ]

  return { system: SYSTEM_PROMPT_EXTRACT, prompt: lines.join('\n') }
}
