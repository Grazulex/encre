import { readdirSync, readFileSync } from 'fs'
import { join, basename } from 'path'
import { marked } from 'marked'
// '@tiptap/html' résout vers la variante navigateur dès qu'on est chargé en
// CommonJS (l'export conditionnel "require" du package n'a pas de branche
// "node", contrairement à "import") — c'est le cas du process main d'Electron
// une fois bundlé par electron-vite, d'où le crash "can only be used in a
// browser environment" en prod comme en dev. L'import explicite du sous-chemin
// /server force la variante Node (DOM simulé via linkedom) dans tous les cas.
import { generateJSON } from '@tiptap/html/server'
import { StarterKit } from '@tiptap/starter-kit'
import { stripCodeBlocks } from '../shared/stripCodeBlocks'

const EXTENSIONS = [StarterKit.configure({ codeBlock: false, code: false })]

// Saut de page en Markdown : `<!-- page-break -->` (le seul marqueur MD
// raisonnable, cf. export.ts). Ni marked ni generateJSON ne connaissent ce
// nœud : un commentaire HTML au milieu du texte est simplement absorbé par
// le parseur HTML de marked et disparaît avant d'atteindre generateJSON.
// Stratégie placeholder : avant marked, chaque ligne EXACTEMENT égale à
// `<!-- page-break -->` (espaces de bord tolérés) est remplacée par un
// paragraphe contenant un jeton unique, qui redevient un texte `%%ENCRE-
// PAGE-BREAK%%` après generateJSON ; on repère ensuite tout paragraphe dont
// le texte est EXACTEMENT ce jeton et on le convertit en nœud `pageBreak`.
// Collision acceptée : un auteur qui écrirait littéralement ce jeton en
// pleine ligne verrait sa ligne convertie en saut de page — improbable, et
// documenté ici plutôt que contourné par un jeton imprononçable.
//
// Fix 4 (correctif review) : quand le commentaire n'est PAS entouré de lignes
// vides (ex. `Avant.\n<!-- page-break -->\nAprès.`), le remplacement par le
// jeton ci-dessus a lieu AVANT marked — qui ne sait alors plus reconnaître un
// bloc HTML capable d'interrompre un paragraphe (ce qu'un vrai `<!-- … -->`
// aurait fait nativement) : les trois lignes fusionnent en un seul paragraphe
// où le DOM (linkedom, via generateJSON) collapse en plus les retours à la
// ligne en simples espaces. Le jeton se retrouve donc au milieu d'un texte,
// jamais seul dans un paragraphe — le test d'égalité exacte ci-dessus ne le
// détecte pas et le jeton fuit tel quel dans le contenu. La détection est
// donc étendue : tout nœud `text` contenant le jeton, même entouré d'autre
// texte, déclenche l'éclatement du paragraphe parent en (paragraphe avant?,
// pageBreak, paragraphe après?).
const PAGE_BREAK_TOKEN = '%%ENCRE-PAGE-BREAK%%'
const PAGE_BREAK_COMMENT_LINE = /^[ \t]*<!--\s*page-break\s*-->[ \t]*$/gm

interface TipNode {
  type?: string
  text?: string
  content?: TipNode[]
}

// Éclate un paragraphe contenant le jeton (au milieu ou seul) en jusqu'à trois
// nœuds : paragraphe(avant) si non vide, pageBreak, paragraphe(après) si non
// vide. Ne fait rien si le paragraphe ne contient pas le jeton — renvoie alors
// le nœud seul (inchangé) sous forme de tableau à un élément.
function splitParagraphOnPageBreakToken(node: TipNode): TipNode[] {
  if (node?.type !== 'paragraph' || !Array.isArray(node.content)) return [node]
  const idx = node.content.findIndex(
    (c) => c?.type === 'text' && typeof c.text === 'string' && c.text.includes(PAGE_BREAK_TOKEN)
  )
  if (idx === -1) return [node]
  const target = node.content[idx]
  const tokenText = target.text!
  const tokenPos = tokenText.indexOf(PAGE_BREAK_TOKEN)
  const beforeText = tokenText.slice(0, tokenPos).replace(/\s+$/, '')
  const afterText = tokenText.slice(tokenPos + PAGE_BREAK_TOKEN.length).replace(/^\s+/, '')

  const beforeContent = [
    ...node.content.slice(0, idx),
    ...(beforeText ? [{ ...target, text: beforeText }] : [])
  ]
  const afterContent = [
    ...(afterText ? [{ ...target, text: afterText }] : []),
    ...node.content.slice(idx + 1)
  ]

  const result: TipNode[] = []
  if (beforeContent.length) result.push({ type: 'paragraph', content: beforeContent })
  result.push({ type: 'pageBreak' })
  if (afterContent.length) result.push({ type: 'paragraph', content: afterContent })
  return result
}

function convertPageBreakPlaceholders(node: TipNode): TipNode {
  if (!node || typeof node !== 'object') return node
  if (Array.isArray(node.content)) {
    const content = node.content
      .map(convertPageBreakPlaceholders)
      .flatMap(splitParagraphOnPageBreakToken)
    return { ...node, content }
  }
  return node
}

function titleFromFilename(file: string): string {
  return basename(file, '.md')
    .replace(/^\d+[\s._-]*/, '')
    .replace(/[_-]+/g, ' ')
    .trim()
}

// Titre d'un chapitre importé : le premier `# Titre` du fichier s'il existe,
// sinon le nom de fichier nettoyé (numéro de tri et séparateurs retirés).
// Partagé par scanChapterFiles (import d'un dossier entier, Task 8) et
// importChapterFromFile (import d'un fichier isolé, Task 8b) pour ne jamais
// faire diverger les deux règles de titrage.
export function titleForFile(filePath: string, content: string): string {
  const heading = content.match(/^#\s+(.+)$/m)
  return heading ? heading[1].trim() : titleFromFilename(filePath)
}

export function scanChapterFiles(folder: string): { file: string; title: string }[] {
  const files = readdirSync(folder)
    .filter((f) => f.toLowerCase().endsWith('.md'))
    .sort((a, b) => {
      const na = parseInt(a, 10)
      const nb = parseInt(b, 10)
      if (!Number.isNaN(na) && !Number.isNaN(nb) && na !== nb) return na - nb
      return a.localeCompare(b, 'fr')
    })
  return files.map((f) => {
    const content = readFileSync(join(folder, f), 'utf8')
    return { file: f, title: titleForFile(f, content) }
  })
}

const INLINE_TYPES = new Set(['text', 'mention', 'hardBreak'])

function docText(node: TipNode): string {
  if (node?.type === 'text') return node.text ?? ''
  if (node?.type === 'hardBreak') return '\n'
  const children = node?.content ?? []
  if (children.length === 0) return ''
  // Les enfants inline (texte, mention, saut de ligne) se concatènent sans
  // séparateur ; tout le reste (paragraphes, items de liste, citations, …)
  // est un conteneur de blocs et doit être séparé par des retours à la ligne
  // pour ne pas coller le texte de blocs distincts (ex. "Item 1Item 2").
  const allInline = children.every((c) => INLINE_TYPES.has(c.type ?? ''))
  return children.map(docText).join(allInline ? '' : '\n')
}

export interface MdToTiptapJsonOptions {
  // Retire le premier `# Titre` de tête (il devient le titre du CHAPITRE, pas
  // son corps) — sémantique propre à l'IMPORT de fichier (scanChapterFiles/
  // importChapterFromFile), où le fichier entier représente un chapitre requis
  // fournir avec cet en-tête. Par défaut `true` pour ne rien changer aux
  // appelants existants. Task 6 (harmonisation, correctif review) : le
  // round-trip tiptapToMarkdown → Claude → mdToTiptapJson envoie le Markdown
  // du CORPS d'un chapitre déjà existant, où un `# …` en tête n'est pas un
  // titre de fichier mais un vrai titre H1 écrit par l'auteur DANS le texte
  // (tiptapToMarkdown rend un nœud heading niveau 1 comme une ligne `# …`,
  // src/shared/export.ts) : le stripping par défaut l'aurait silencieusement
  // effacé à l'application (« Appliquer » aurait fait disparaître ce
  // paragraphe), alors que FormatDialog l'affichait encore intact côté
  // « Après » — divergence aperçu/persisté. `ai.formatToJson` passe donc
  // `stripLeadingH1: false`.
  stripLeadingH1?: boolean
}

export function mdToTiptapJson(
  md: string,
  options: MdToTiptapJsonOptions = {}
): { contentJson: string; contentText: string } {
  const stripLeadingH1 = options.stripLeadingH1 ?? true
  // retirer le premier # Titre (il devient le titre du chapitre, pas son corps)
  // — tolérant aux lignes vides/espaces qui précéderaient ce titre de tête.
  const body = stripLeadingH1 ? md.replace(/^\s*#\s+.+\n+/, '') : md
  // Placeholder pageBreak (voir commentaire plus haut) avant marked : le
  // commentaire HTML `<!-- page-break -->` ne survivrait pas au parseur.
  const withPlaceholder = body.replace(PAGE_BREAK_COMMENT_LINE, PAGE_BREAK_TOKEN)
  const html = marked.parse(withPlaceholder, { async: false }) as string
  const raw = generateJSON(html, EXTENSIONS)
  const { json } = stripCodeBlocks(JSON.stringify(raw)) // ceinture + bretelles
  const doc = convertPageBreakPlaceholders(JSON.parse(json))
  return { contentJson: JSON.stringify(doc), contentText: docText(doc).trim() }
}
