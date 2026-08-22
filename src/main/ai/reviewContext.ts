import type { Db } from '../db/connection'
import { getChapter, entitiesInChapter } from '../db/chapters'
import { getBook } from '../db/books'
import { listEntities } from '../db/entities'
import { tiptapToMarkdown } from '../../shared/export'
import type { Entity } from '../../shared/types'
import type { FormatPromptBundle } from './formatContext'

// Réexporté pour ne pas forcer les consommateurs (reviewContext.test.ts, api.ts)
// à importer FormatPromptBundle depuis formatContext.ts : les deux prompts
// (harmonisation, relecture) partagent la même forme { system, prompt }.
export type { FormatPromptBundle }

const KIND_LABELS: Record<string, string> = {
  character: 'Personnage',
  place: 'Lieu'
}

// Même rendu de fiche que buildWritePrompt (main/ai/context.ts) — dupliqué
// plutôt qu'importé : formatEntity y est un détail interne non exporté, et ce
// prompt-ci n'a pas besoin de tronquer les notes à la même longueur (les
// incohérences peuvent se nicher dans un détail que l'excerpt de write
// couperait).
function formatEntity(entity: Entity): string {
  const lines: string[] = [`### ${entity.name} (${KIND_LABELS[entity.kind] ?? entity.kind})`]
  if (entity.aliases.length > 0) lines.push(`Alias : ${entity.aliases.join(', ')}`)
  if (entity.description.trim()) lines.push(`Description : ${entity.description.trim()}`)
  const attrEntries = Object.entries(entity.attributes)
  if (attrEntries.length > 0) {
    lines.push('Attributs :')
    for (const [key, value] of attrEntries) lines.push(`- ${key}: ${value}`)
  }
  if (entity.notes.trim()) lines.push(`Notes : ${entity.notes.trim()}`)
  return lines.join('\n')
}

// System prompt de relecture (Task 2, plan 3c) : contrat de sortie STRICT — un
// tableau JSON de ReviewSuggestion (src/shared/types.ts) et rien d'autre. Les
// noms de champs et les valeurs autorisées de `type` sont recopiés mot pour
// mot ici pour que Claude ne les invente pas ; `quote` est explicitement
// désigné comme la clé de repérage côté renderer (Task 3), d'où l'exigence
// d'un extrait copié mot pour mot — un extrait qui ne correspond pas
// exactement au texte du chapitre sera écarté à l'affichage, donc inutile.
const SYSTEM_PROMPT_REVIEW =
  "Tu es relecteur littéraire. On te donne le texte d'un chapitre en Markdown, " +
  "son résumé et les fiches des personnages et lieux qui y apparaissent. " +
  'Tu repères des problèmes CIBLÉS et PEU NOMBREUX : répétitions maladroites, ' +
  'incohérences (noms, faits, chronologie) avec les fiches ou le résumé fournis, ' +
  "points de style maladroits, fautes d'orthographe ou de grammaire. " +
  'Sortie : UNIQUEMENT un tableau JSON, sans aucun texte avant ni après, sans ' +
  "bloc de code Markdown (pas de ```), d'objets ayant EXACTEMENT ces champs : " +
  '`type` (une valeur parmi "repetition", "incoherence", "style", ' +
  '"orthographe"), `quote` (string), `replacement` (string), `reason` (string). ' +
  '`quote` doit être un extrait copié MOT POUR MOT depuis le texte du chapitre ' +
  'ci-dessous : c\'est la clé qui permet de le repérer dans le texte — toute ' +
  'citation qui ne correspond pas exactement, au caractère près, sera ignorée. ' +
  '`replacement` est le texte de remplacement proposé pour cet extrait (chaîne ' +
  "vide '' pour une simple suppression). `reason` est une explication courte, " +
  'en français. ' +
  'Maximum une vingtaine (20) de suggestions au total : ne signale que ce qui ' +
  'est vraiment notable, reste silencieux sur le reste. ' +
  'Tu ne proposes JAMAIS de réécriture globale du chapitre, ni de suggestion ' +
  'portant sur le chapitre entier ou un paragraphe entier réécrit : chaque ' +
  'suggestion cible un extrait précis et limité (quelques mots à une phrase).'

/** Construit le prompt de relecture (suggestions ciblées) pour un chapitre donné. */
export function buildReviewPrompt(db: Db, chapterId: number): FormatPromptBundle {
  const chapter = getChapter(db, chapterId)
  const book = getBook(db, chapter.bookId)
  const markdown = tiptapToMarkdown(chapter.contentJson)

  // Ruling du contrôleur (Task 2) : les fiches jointes au prompt sont celles
  // des entités liées au chapitre via mentions ; si aucune (chapitre sans
  // mention posée), on retombe sur la liste complète des fiches du livre —
  // mieux vaut un contexte trop large que pas de fiches du tout pour détecter
  // une incohérence de nom ou de fait.
  const linkedEntities = entitiesInChapter(db, chapterId)
  const entityList = linkedEntities.length > 0 ? linkedEntities : listEntities(db, book.id)
  const entityBlocks = entityList.map(formatEntity)

  const resume = chapter.summary.trim() ? chapter.summary.trim() : 'Aucun résumé fourni pour ce chapitre.'

  const lines: string[] = [
    '## RÉSUMÉ DU CHAPITRE',
    resume,
    '',
    '## PERSONNAGES ET LIEUX (fiches pour repérer les incohérences de noms et de faits)',
    entityBlocks.length > 0 ? entityBlocks.join('\n\n') : '(aucune fiche disponible pour ce livre)',
    '',
    'Format de sortie : réponds UNIQUEMENT par le tableau JSON de suggestions, ' +
      "sans phrase d'introduction, sans commentaire, sans bloc de code Markdown.",
    '',
    '## CHAPITRE (Markdown)',
    '',
    markdown
  ]

  return { system: SYSTEM_PROMPT_REVIEW, prompt: lines.join('\n') }
}
