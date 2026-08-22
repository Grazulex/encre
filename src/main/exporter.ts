import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import type { Db } from './db/connection'
import { getBook } from './db/books'
import { listChapters, getChapter } from './db/chapters'
import { tiptapToMarkdown } from '../shared/export'

export function slugify(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'chapitre'
}

export function exportMarkdownToFolder(db: Db, bookId: number, folder: string): string {
  mkdirSync(folder, { recursive: true })
  const chapters = listChapters(db, bookId)
  for (const meta of chapters) {
    const full = getChapter(db, meta.id)
    const name = `${String(meta.position).padStart(2, '0')}-${slugify(meta.title)}.md`
    const body = tiptapToMarkdown(full.contentJson)
    writeFileSync(join(folder, name), `# ${meta.title}\n\n${body}`)
  }
  void getBook(db, bookId)
  return folder
}
