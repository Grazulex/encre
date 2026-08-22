import type { Db } from '../db/connection'
import { getChapter } from '../db/chapters'
import { tiptapToMarkdown } from '../../shared/export'
// FormatConventions vit dans shared/types.ts (Task 6, controller precisions) :
// le renderer doit construire la même forme pour l'appel IPC ai.startFormat,
// or ce module-ci importe des dépendances main-only (db/chapters) qu'un
// import renderer ne peut pas suivre. Réexporté pour ne pas casser les
// consommateurs existants (formatContext.test.ts) qui importent le type d'ici.
export type { FormatConventions } from '../../shared/types'
import type { FormatConventions } from '../../shared/types'

export interface FormatPromptBundle {
  system: string
  prompt: string
}

const SYSTEM_PROMPT =
  "Tu es typographe littéraire. On te donne le texte d'un chapitre en Markdown. " +
  'Tu rends le MÊME texte, mots et ponctuation du récit inchangés, en normalisant ' +
  'UNIQUEMENT la mise en forme selon les conventions demandées : dialogues, listes, ' +
  'séparateurs de scène (uniquement la ligne `***`), et rien d\'autre. ' +
  'Tu ne réécris JAMAIS une phrase, tu ne corriges pas le style, ' +
  "tu n'ajoutes ni ne retires de contenu. " +
  'Sortie : le Markdown complet du chapitre, rien d\'autre.'

const DIALOGUE_EXAMPLES: Record<FormatConventions['dialogue'], string> = {
  guillemets: '« Bonjour », dit-il.',
  tirets: '— Bonjour, dit-il.'
}

const LISTE_EXAMPLES: Record<FormatConventions['listes'], string> = {
  tirets: '- élément',
  puces: '• élément'
}

/** Construit le prompt d'harmonisation typographique pour un chapitre donné. */
// Task 6b : sentence de préservation des marqueurs. En mode « proposition »,
// l'interdiction de suppression/déplacement reste intacte, mais l'ajout de
// marqueurs devient explicitement autorisé (voir bloc PROPOSAL_BLOCK ci-dessous
// pour le détail des règles) — d'où le renvoi "voir consignes ci-dessous" pour
// ne pas dupliquer les règles à deux endroits du prompt.
const PRESERVE_STRICT =
  'Important : les lignes `***` (séparateur de scène) et `<!-- page-break -->' +
  '` (saut de page) présentes dans le texte ci-dessous sont des marqueurs déjà ' +
  'canoniques. Elles ne font pas partie du texte du récit : préserve-les ' +
  'exactement telles quelles, sans les modifier, déplacer ni supprimer.'

const PRESERVE_WITH_PROPOSALS =
  'Important : les lignes `***` (séparateur de scène) et `<!-- page-break -->' +
  '` (saut de page) présentes dans le texte ci-dessous sont des marqueurs déjà ' +
  'canoniques. Elles ne font pas partie du texte du récit : préserve-les ' +
  'exactement telles quelles — tu peux en AJOUTER (voir consignes ci-dessous), ' +
  'jamais en retirer ni déplacer celles qui existent déjà.'

const PROPOSAL_BLOCK = [
  'Proposition de séparations manquantes (option activée) : en plus de la ' +
    'préservation ci-dessus, tu PEUX ajouter de nouvelles lignes `***` aux ' +
    'endroits du texte où une transition de scène manifeste se produit sans ' +
    'séparateur (saut de temps, changement de lieu, changement de point de ' +
    'vue). Plus rare et plus conservateur : tu peux aussi ajouter une ligne ' +
    '`<!-- page-break -->` là où une rupture structurelle majeure est ' +
    'évidente (début d\'une nouvelle partie). Règles strictes : ce ne sont que ' +
    'des INSERTIONS de lignes de marqueur ; tu ne modifies, ne réécris ni ne ' +
    'déplaces jamais une phrase du récit pour cela, et tu ne retires ni ne ' +
    'déplaces jamais un marqueur déjà présent. Dans le doute, abstiens-toi.'
].join('\n')

export function buildFormatPrompt(db: Db, chapterId: number, conventions: FormatConventions): FormatPromptBundle {
  const chapter = getChapter(db, chapterId)
  const markdown = tiptapToMarkdown(chapter.contentJson)

  const lines: string[] = [
    'Conventions de mise en forme cibles pour ce chapitre :',
    '',
    `- Dialogue : ${conventions.dialogue} — exemple : ${DIALOGUE_EXAMPLES[conventions.dialogue]}`,
    `- Listes : ${conventions.listes} — exemple : ${LISTE_EXAMPLES[conventions.listes]}`,
    '- Séparateur de scène : une ligne contenant uniquement `***`.',
    '',
    'Marqueurs hétérogènes existants à convertir vers les conventions ci-dessus ' +
      '(dialogues, listes ou séparateurs selon leur usage) : `* * *`, `•`, `●`, `~~~`, ' +
      'lignes de tirets (`---`, `———`), et toute variante équivalente.',
    '',
    conventions.proposerSeparations ? PRESERVE_WITH_PROPOSALS : PRESERVE_STRICT
  ]

  if (conventions.proposerSeparations) {
    lines.push('', PROPOSAL_BLOCK)
  }

  lines.push(
    '',
    'Format de sortie : réponds UNIQUEMENT par le texte du chapitre, en commençant ' +
      "directement à sa toute première ligne. N'écris aucune phrase d'introduction " +
      "ou d'annonce (par ex. « Voici le texte harmonisé : »), ne recopie pas le " +
      'titre « ## CHAPITRE (Markdown) » ci-dessous (il ne sert qu\'à délimiter ce ' +
      "prompt, il ne fait pas partie du chapitre), et n'ajoute aucun commentaire " +
      'après le texte.',
    '',
    '## CHAPITRE (Markdown)',
    '',
    markdown
  )

  return { system: SYSTEM_PROMPT, prompt: lines.join('\n') }
}
