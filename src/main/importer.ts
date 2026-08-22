import { readdirSync, readFileSync } from 'fs'
import { join, basename } from 'path'
import { marked } from 'marked'
import { generateJSON } from '@tiptap/html'
import StarterKit from '@tiptap/starter-kit'
import { stripCodeBlocks } from '../shared/stripCodeBlocks'

const EXTENSIONS = [StarterKit.configure({ codeBlock: false, code: false })]

function titleFromFilename(file: string): string {
  return basename(file, '.md').replace(/^\d+[\s._-]*/, '').replace(/[_-]+/g, ' ').trim()
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
    const heading = content.match(/^#\s+(.+)$/m)
    return { file: f, title: heading ? heading[1].trim() : titleFromFilename(f) }
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

export function mdToTiptapJson(md: string): { contentJson: string; contentText: string } {
  // retirer le premier # Titre (il devient le titre du chapitre, pas son corps)
  // — tolérant aux lignes vides/espaces qui précéderaient ce titre de tête.
  const body = md.replace(/^\s*#\s+.+\n+/, '')
  const html = marked.parse(body, { async: false }) as string
  const raw = generateJSON(html, EXTENSIONS)
  const { json } = stripCodeBlocks(JSON.stringify(raw)) // ceinture + bretelles
  const doc = JSON.parse(json)
  return { contentJson: json, contentText: docText(doc).trim() }
}
