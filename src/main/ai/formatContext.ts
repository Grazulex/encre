import type { Db } from '../db/connection'
import { getChapter } from '../db/chapters'
import { tiptapToMarkdown } from '../../shared/export'

export interface FormatConventions {
  dialogue: 'guillemets' | 'tirets' // « … » vs — cadratins
  listes: 'tirets' | 'puces'
}

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
    'Important : les lignes `***` (séparateur de scène) et `<!-- page-break -->` ' +
      '(saut de page) présentes dans le texte ci-dessous sont des marqueurs déjà ' +
      'canoniques. Elles ne font pas partie du texte du récit : préserve-les ' +
      'exactement telles quelles, sans les modifier, déplacer ni supprimer.',
    '',
    '## CHAPITRE (Markdown)',
    '',
    markdown
  ]

  return { system: SYSTEM_PROMPT, prompt: lines.join('\n') }
}
