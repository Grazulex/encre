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
const PAGE_BREAK_TOKEN = '%%ENCRE-PAGE-BREAK%%'
const PAGE_BREAK_COMMENT_LINE = /^[ \t]*<!--\s*page-break\s*-->[ \t]*$/gm

function convertPageBreakPlaceholders(node: any): any {
  if (!node || typeof node !== 'object') return node
  let out = node
  if (
    out.type === 'paragraph' &&
    Array.isArray(out.content) &&
    out.content.length === 1 &&
    out.content[0]?.type === 'text' &&
    out.content[0]?.text === PAGE_BREAK_TOKEN
  ) {
    return { type: 'pageBreak' }
  }
  if (Array.isArray(out.content)) {
    out = { ...out, content: out.content.map(convertPageBreakPlaceholders) }
  }
  return out
}

function titleFromFilename(file: string): string {
  return basename(file, '.md').replace(/^\d+[\s._-]*/, '').replace(/[_-]+/g, ' ').trim()
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

function docText(node: any): string {
  if (node?.type === 'text') return node.text ?? ''
  if (node?.type === 'hardBreak') return '\n'
  const children = node?.content ?? []
  if (children.length === 0) return ''
  // Les enfants inline (texte, mention, saut de ligne) se concatènent sans
  // séparateur ; tout le reste (paragraphes, items de liste, citations, …)
  // est un conteneur de blocs et doit être séparé par des retours à la ligne
  // pour ne pas coller le texte de blocs distincts (ex. "Item 1Item 2").
  const allInline = children.every((c: any) => INLINE_TYPES.has(c?.type))
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
