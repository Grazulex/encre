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

// Task 6b, fix round 2 (défaut utilisateur : zéro proposition en usage réel) :
// le system prompt PRIME sur le prompt utilisateur. Tant que SYSTEM_PROMPT
// restait inconditionnel ("et rien d'autre", "tu n'ajoutes ni ne retires de
// contenu"), Claude refusait systématiquement les insertions que
// PROPOSAL_BLOCK (prompt utilisateur, voir plus bas) autorisait pourtant — le
// system prompt l'emportait. SYSTEM_PROMPT_STRICT reste BYTE-IDENTIQUE au
// system prompt historique (mode par défaut, proposerSeparations=false).
//
// Fix round 3 (review) : SYSTEM_PROMPT_WITH_PROPOSALS n'est PLUS dérivé par
// concaténation de SYSTEM_PROMPT_STRICT + une exception ajoutée en fin de
// texte — cette approche laissait passer telles quelles, non reformulées,
// les phrases mêmes qui causaient le bug (« et rien d'autre »,
// « tu n'ajoutes ni ne retires de contenu »), l'exception n'étant qu'un
// pansement en toute fin de prompt. C'est désormais un texte autonome et
// cohérent de bout en bout : la phrase de normalisation intègre directement
// l'autorisation d'insérer des marqueurs (au lieu de dire "et rien d'autre"
// puis de se contredire plus loin), et la phrase anti-ajout/retrait est
// reformulée pour porter explicitement sur les MOTS du récit (jamais sur les
// lignes-marqueurs, seules additions permises). Aucune phrase de ce texte
// n'interdit ce qu'une autre autorise — relu de bout en bout à chaque
// modification.
const SYSTEM_PROMPT_STRICT =
  "Tu es typographe littéraire. On te donne le texte d'un chapitre en Markdown. " +
  'Tu rends le MÊME texte, mots et ponctuation du récit inchangés, en normalisant ' +
  'UNIQUEMENT la mise en forme selon les conventions demandées : dialogues, listes, ' +
  'séparateurs de scène (uniquement la ligne `***`), et rien d\'autre. ' +
  'Tu ne réécris JAMAIS une phrase, tu ne corriges pas le style, ' +
  "tu n'ajoutes ni ne retires de contenu. " +
  'Sortie : le Markdown complet du chapitre, rien d\'autre.'

const SYSTEM_PROMPT_WITH_PROPOSALS =
  "Tu es typographe littéraire. On te donne le texte d'un chapitre en Markdown. " +
  'Tu rends le MÊME texte, mots et ponctuation du récit inchangés, en normalisant ' +
  'la mise en forme selon les conventions demandées : dialogues, listes, séparateurs ' +
  'de scène (uniquement la ligne `***`) ; dans ce mode, tu PEUX AUSSI INSÉRER une ' +
  'ligne-marqueur `***` (transition de scène manifeste) ou `<!-- page-break -->` ' +
  '(rupture structurelle majeure) là où elle manque encore — uniquement des lignes ' +
  'entières de marqueur, rien de plus. ' +
  'Tu ne réécris JAMAIS une phrase, tu ne corriges pas le style. ' +
  "Tu n'ajoutes ni ne retires JAMAIS le moindre mot du texte du récit : les seules " +
  'additions permises sont ces lignes-marqueurs, et tu ne retires ni ne déplaces ' +
  'jamais un marqueur déjà présent. ' +
  'Sortie : le Markdown complet du chapitre, ces éventuelles insertions de ' +
  "marqueurs comprises, rien d'autre."

const DIALOGUE_EXAMPLES: Record<FormatConventions['dialogue'], string> = {
  guillemets: '« Bonjour », dit-il.',
  tirets: '— Bonjour, dit-il.'
}

// Fix 2 (correctif review, décision arbitrage) : au niveau Markdown, une VRAIE
// liste (bulletList/orderedList — désormais sérialisée en syntaxe `- `/`1. `
// standard, cf. tiptapToMarkdown dans src/shared/export.ts) doit TOUJOURS
// rester en syntaxe Markdown standard, dans les deux conventions — c'est ce
// qui préserve sa structure au round-trip d'harmonisation. Une ligne
// « • élément » n'est PAS une liste Markdown : à la réimportation
// (mdToTiptapJson), elle redevient un simple paragraphe de texte, structure
// perdue. La convention tirets/puces porte donc sur le style d'une
// ÉNUMÉRATION EN PROSE (pas une liste structurée) — ex. une numérotation
// informelle glissée dans une phrase — jamais sur la syntaxe d'une vraie
// liste Markdown, rappelée explicitement dans le prompt ci-dessous.
const LISTE_EXAMPLES: Record<FormatConventions['listes'], string> = {
  tirets: '- élément (énumération en prose)',
  puces: '• élément (énumération en prose)'
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
    'préservation ci-dessus, ajoute une ligne `***` à CHAQUE endroit du texte ' +
    'où une transition de scène manifeste se produit sans séparateur (saut de ' +
    'temps, changement de lieu, changement de point de vue) — ce sont des cas ' +
    'fréquents, ne sois pas timide sur ce point : préfère proposer une ' +
    'transition clairement identifiable plutôt que de t\'abstenir. Plus rare ' +
    'et plus conservateur : ajoute aussi une ligne `<!-- page-break -->` là ' +
    'où une rupture structurelle majeure est évidente (début d\'une nouvelle ' +
    'partie) — ici seulement, abstiens-toi si le doute est réel. Règles ' +
    'strictes dans tous les cas : ce ne sont que des INSERTIONS de lignes de ' +
    'marqueur ; tu ne modifies, ne réécris ni ne déplaces jamais une phrase ' +
    'du récit pour cela, et tu ne retires ni ne déplaces jamais un marqueur ' +
    'déjà présent.'
].join('\n')

export function buildFormatPrompt(db: Db, chapterId: number, conventions: FormatConventions): FormatPromptBundle {
  const chapter = getChapter(db, chapterId)
  const markdown = tiptapToMarkdown(chapter.contentJson)

  const lines: string[] = [
    'Conventions de mise en forme cibles pour ce chapitre :',
    '',
    `- Dialogue : ${conventions.dialogue} — exemple : ${DIALOGUE_EXAMPLES[conventions.dialogue]}`,
    `- Listes (énumérations en prose, hors listes Markdown structurées) : ${conventions.listes} — ` +
      `exemple : ${LISTE_EXAMPLES[conventions.listes]}`,
    "- Important : une vraie liste Markdown déjà présente (lignes commençant par `- `, `* `, `+ ` ou " +
      "`1. `, `2. `, …) reste TOUJOURS en syntaxe Markdown standard `- élément` / `1. élément`, dans les " +
      'DEUX conventions ci-dessus — ne la convertis JAMAIS en paragraphes préfixés par un caractère de ' +
      'puce ou de tiret, sous peine d\'en perdre la structure.',
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

  const system = conventions.proposerSeparations ? SYSTEM_PROMPT_WITH_PROPOSALS : SYSTEM_PROMPT_STRICT

  return { system, prompt: lines.join('\n') }
}
