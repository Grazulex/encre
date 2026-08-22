import type { Db } from './connection'
import type { Chapter, ChapterMeta, ChapterStatus } from '../../shared/types'

export function countWords(text: string): number {
  const trimmed = text.trim()
  return trimmed ? trimmed.split(/\s+/).length : 0
}

function rowToMeta(row: any): ChapterMeta {
  return {
    id: row.id,
    bookId: row.book_id,
    position: row.position,
    title: row.title,
    status: row.status,
    wordCount: row.word_count,
    updatedAt: row.updated_at
  }
}

export function listChapters(db: Db, bookId: number): ChapterMeta[] {
  return db
    .prepare(
      `SELECT id, book_id, position, title, status, word_count, updated_at
       FROM chapters WHERE book_id = ? ORDER BY position`
    )
    .all(bookId)
    .map(rowToMeta)
}

export function getChapter(db: Db, id: number): Chapter {
  const row = db.prepare('SELECT * FROM chapters WHERE id = ?').get(id) as any
  if (!row) throw new Error(`Chapitre introuvable: ${id}`)
  return { ...rowToMeta(row), contentJson: row.content_json, contentText: row.content_text }
}

export function createChapter(db: Db, bookId: number, title: string): ChapterMeta {
  const result = db
    .prepare(
      `INSERT INTO chapters (book_id, position, title)
       VALUES (?, (SELECT COALESCE(MAX(position), 0) + 1 FROM chapters WHERE book_id = ?), ?)`
    )
    .run(bookId, bookId, title)
  const meta = getChapter(db, Number(result.lastInsertRowid))
  return rowToMeta({
    id: meta.id, book_id: meta.bookId, position: meta.position, title: meta.title,
    status: meta.status, word_count: meta.wordCount, updated_at: meta.updatedAt
  })
}

export function saveChapterContent(
  db: Db, id: number, contentJson: string, contentText: string
): { wordCount: number } {
  const wordCount = countWords(contentText)
  db.prepare(
    `UPDATE chapters
     SET content_json = ?, content_text = ?, word_count = ?, updated_at = datetime('now')
     WHERE id = ?`
  ).run(contentJson, contentText, wordCount, id)
  return { wordCount }
}

export function renameChapter(db: Db, id: number, title: string): void {
  db.prepare("UPDATE chapters SET title = ?, updated_at = datetime('now') WHERE id = ?").run(title, id)
}

export function setChapterStatus(db: Db, id: number, status: ChapterStatus): void {
  db.prepare("UPDATE chapters SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, id)
}

export function reorderChapters(db: Db, bookId: number, orderedIds: number[]): void {
  const stmt = db.prepare('UPDATE chapters SET position = ? WHERE id = ? AND book_id = ?')
  db.transaction(() => {
    orderedIds.forEach((id, index) => stmt.run(index + 1, id, bookId))
  })()
}

export function deleteChapter(db: Db, id: number): void {
  db.prepare('DELETE FROM chapters WHERE id = ?').run(id)
}
