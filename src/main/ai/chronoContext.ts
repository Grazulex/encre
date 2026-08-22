import type { Db } from '../db/connection'
import { getBook } from '../db/books'
import { listChapterSummaries } from '../db/chapters'
import { listTimeline } from '../db/timeline'
import { listOutline } from '../db/outline'
import { listEntities } from '../db/entities'
import type { FormatPromptBundle } from './formatContext'

// Réexporté pour ne pas forcer les consommateurs (chronoContext.test.ts, api.ts)
// à importer FormatPromptBundle depuis formatContext.ts : les quatre prompts
// (harmonisation, relecture, extraction, chronologie) partagent la même forme
// { system, prompt}.
export type { FormatPromptBundle }

const KIND_LABELS: Record<string, string> = {
  character: 'Personnage',
  place: 'Lieu'
}

// System prompt de vérification de chronologie (Task 6, plan 3c) : contrat de
// sortie STRICT — un tableau JSON de ChronoIssue (src/shared/types.ts) et rien
// d'autre, même logique que SYSTEM_PROMPT_REVIEW (reviewContext.ts) et
// SYSTEM_PROMPT_EXTRACT (extractContext.ts) pour les noms de champs et les
// valeurs autorisées. Deux garde-fous spécifiques à cette tâche :
// - `chapterIds`/`eventIds` doivent être des ids RÉELLEMENT fournis dans le
//   prompt (inventer un id est interdit — même raisonnement que `entityId`
//   dans extractContext.ts) ;
// - un chapitre listé sans résumé (« (pas de résumé) », voir buildChronoPrompt
//   ci-dessous) est un ANGLE MORT à signaler comme limite de l'analyse,
//   jamais un prétexte à inventer un contenu qui n'a pas été fourni.
const SYSTEM_PROMPT_CHRONO =
  "Tu es continuité littéraire. On te donne, pour un livre ENTIER (jamais le texte intégral des " +
  'chapitres, seulement leurs résumés manuels — tu dois raisonner à partir de ce résumé, du plan et ' +
  "de la chronologie fournis), la liste de ses chapitres (id, position, titre, résumé), sa " +
  'chronologie narrative (id, position, date, titre, description, chapitres et personnages/lieux ' +
  'liés), son plan et la liste de ses personnages et lieux. ' +
  "Tu détectes des incohérences de CHRONOLOGIE : contradictions d'ordre entre les événements, dates " +
  "incompatibles entre elles ou avec l'ordre des chapitres, âges ou durées qui ne concordent pas, " +
  'événements liés à des chapitres incompatibles avec leur place dans le récit. ' +
  'Sortie : UNIQUEMENT un tableau JSON, sans aucun texte avant ni après, sans bloc de code Markdown ' +
  "(pas de ```), d'objets ayant EXACTEMENT ces champs : `severity` (une valeur parmi " +
  '"incoherence" pour une contradiction avérée, "doute" pour un soupçon qui mériterait une ' +
  'vérification par l\'autrice ou l\'auteur), `description` (string, en français, autoportante — ' +
  'compréhensible sans relire le livre), `chapterIds` (tableau des ids de chapitres, parmi ceux ' +
  "fournis ci-dessous, impliqués dans cette incohérence — peut être vide), `eventIds` (tableau des " +
  "ids d'événements de chronologie, parmi ceux fournis ci-dessous, impliqués — peut être vide). " +
  "N'INVENTE JAMAIS un id : chaque chapterId/eventId DOIT être recopié tel quel depuis les listes " +
  "fournies ci-dessous ; un id inventé, approximatif ou absent de ces listes est INTERDIT. " +
  "Un chapitre marqué « (pas de résumé) » est un ANGLE MORT : tu peux le signaler (severity " +
  '"doute") comme une limite de l\'analyse si son absence empêche de vérifier une cohérence, mais tu ' +
  "N'INVENTES JAMAIS son contenu ni les faits qu'il pourrait raconter. " +
  "Si aucune incohérence n'est détectée, réponds par un tableau JSON VIDE `[]` : c'est un résultat " +
  'normal et attendu, pas une erreur — reste silencieux plutôt que de signaler quelque chose de ' +
  'ténu ou spéculatif. Réponds en français.'

/**
 * Construit le prompt de vérification de chronologie NIVEAU LIVRE (Task 6,
 * plan 3c) : chapitres (résumés, jamais le texte intégral — l'IA doit garder
 * la maîtrise du contexte sur un livre entier), chronologie complète, plan et
 * entités. Refuse un livre sans chapitre (rien à vérifier).
 */
export function buildChronoPrompt(db: Db, bookId: number): FormatPromptBundle {
  const book = getBook(db, bookId)
  // listChapterSummaries (fix round 1, pas listChapters+getChapter en boucle) :
  // seul moyen léger d'accéder au résumé manuel de chaque chapitre, la donnée
  // centrale de ce prompt (brief : « sans texte intégral, maîtrise du
  // contexte ») — sans charger content_json/content_text pour rien, chapitre
  // par chapitre, comme le ferait un getChapter (SELECT *) répété.
  const chapters = listChapterSummaries(db, bookId)
  if (chapters.length === 0) {
    throw new Error("Ce livre n'a aucun chapitre.")
  }

  const chapterBlocks = chapters.map((chapter) => {
    const summary = chapter.summary.trim()
    const summaryLine = summary ? `  Résumé : ${summary}` : '  (pas de résumé)'
    return `- id ${chapter.id}, position ${chapter.position}, titre « ${chapter.title} »\n${summaryLine}`
  })

  const events = listTimeline(db, bookId)
  const eventBlocks = events.map((event) => {
    const dateLabel = event.dateLabel.trim() ? event.dateLabel.trim() : '(sans date)'
    const block: string[] = [
      `- id ${event.id}, position ${event.position}, date « ${dateLabel} », titre « ${event.title} »`
    ]
    if (event.description.trim()) block.push(`  Description : ${event.description.trim()}`)
    block.push(`  Chapitres liés (ids) : ${event.chapterIds.length > 0 ? event.chapterIds.join(', ') : '(aucun)'}`)
    block.push(
      `  Personnages/lieux liés (ids) : ${event.entityIds.length > 0 ? event.entityIds.join(', ') : '(aucun)'}`
    )
    return block.join('\n')
  })

  const outlineNotes = listOutline(db, bookId)
  const outlineLines = outlineNotes.map((note) => {
    const scope = note.chapterId != null ? `chapitre id ${note.chapterId}` : 'plan général'
    const content = note.content.trim() || '(note vide)'
    return `- (${scope}) ${content}`
  })

  // Liste légère nom/kind uniquement (ruling du contrôleur, Task 6) : pas de
  // 4e copie du formatteur de fiche complet (reviewContext.ts/extractContext.ts/
  // context.ts) — les entités ne servent ici qu'à donner un vocabulaire de
  // noms au modèle, jamais à raisonner sur leurs attributs/description.
  const entityList = listEntities(db, bookId)
  const entityLines = entityList.map(
    (entity) => `- ${entity.name} (${KIND_LABELS[entity.kind] ?? entity.kind})`
  )

  const lines: string[] = [
    `## LIVRE : ${book.title}`,
    '',
    '## CHAPITRES (id, position, titre, résumé manuel)',
    chapterBlocks.join('\n\n'),
    '',
    "## CHRONOLOGIE (événements de l'histoire — id, position, date, titre, description, liens)",
    eventBlocks.length > 0 ? eventBlocks.join('\n\n') : '(aucun événement de chronologie pour ce livre)',
    '',
    '## PLAN',
    outlineLines.length > 0 ? outlineLines.join('\n') : '(aucune note de plan pour ce livre)',
    '',
    '## PERSONNAGES ET LIEUX (nom, type)',
    entityLines.length > 0 ? entityLines.join('\n') : '(aucune fiche pour ce livre)',
    '',
    "Format de sortie : réponds UNIQUEMENT par le tableau JSON d'incohérences, " +
      "sans phrase d'introduction, sans commentaire, sans bloc de code Markdown."
  ]

  return { system: SYSTEM_PROMPT_CHRONO, prompt: lines.join('\n') }
}
