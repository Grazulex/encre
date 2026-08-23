import { writeFileSync, mkdirSync, copyFileSync, existsSync } from 'fs'
import { join, basename } from 'path'
import type { Db } from './db/connection'
import { getBook } from './db/books'
import { listChapters, getChapter } from './db/chapters'
import { tiptapToMarkdown } from '../shared/export'
import type { ExportOptions } from '../shared/export'

export function slugify(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'chapitre'
}

export function exportMarkdownToFolder(db: Db, bookId: number, folder: string, mediaDir?: string): string {
  getBook(db, bookId) // vérifie l'existence du livre — lève si l'id est invalide
  mkdirSync(folder, { recursive: true })
  const chapters = listChapters(db, bookId)

  const illustrationsDir = join(folder, 'Illustrations')
  const copied = new Set<string>()
  // Un seul callback pour tout l'export : chaque fichier référencé est copié
  // une fois, à la première rencontre ; un fichier manquant dans media omet
  // le nœud (pas de lien mort dans le Markdown exporté).
  const opts: ExportOptions = {
    illustration: ({ fileName, displayName }) => {
      // Même garde anti-traversée que le protocole encre-media côté renderer ;
      // un contentJson forgé ne doit pas faire sortir la copie du dossier media.
      if (fileName !== basename(fileName)) return null
      if (!mediaDir || !existsSync(join(mediaDir, fileName))) return null
      if (!copied.has(fileName)) {
        mkdirSync(illustrationsDir, { recursive: true })
        copyFileSync(join(mediaDir, fileName), join(illustrationsDir, fileName))
        copied.add(fileName)
      }
      return { md: `![${displayName}](Illustrations/${fileName})`, xhtml: '' }
    }
  }

  for (const meta of chapters) {
    const full = getChapter(db, meta.id)
    const name = `${String(meta.position).padStart(2, '0')}-${slugify(meta.title)}.md`
    const body = tiptapToMarkdown(full.contentJson, opts)
    writeFileSync(join(folder, name), `# ${meta.title}\n\n${body}`)
  }
  return folder
}
