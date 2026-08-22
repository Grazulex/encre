import type { Db } from './connection'
import type { Chapter, ChapterMeta, ChapterStatus, Entity, EntityOccurrence } from '../../shared/types'
import { extractMentionIds } from '../../shared/mentions'
import { entityRowToEntity } from './entities'

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
  return { ...rowToMeta(row), contentJson: row.content_json, contentText: row.content_text, summary: row.summary }
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
  const mentionIds = extractMentionIds(contentJson)
  db.transaction(() => {
    db.prepare(
      `UPDATE chapters
       SET content_json = ?, content_text = ?, word_count = ?, updated_at = datetime('now')
       WHERE id = ?`
    ).run(contentJson, contentText, wordCount, id)
    db.prepare('DELETE FROM mentions WHERE chapter_id = ?').run(id)
    const insert = db.prepare(
      'INSERT OR IGNORE INTO mentions (chapter_id, entity_id) SELECT ?, id FROM entities WHERE id = ?'
    )
    for (const entityId of mentionIds) insert.run(id, entityId)
    db.prepare(
      `UPDATE books SET updated_at = datetime('now')
       WHERE id = (SELECT book_id FROM chapters WHERE id = ?)`
    ).run(id)
  })()
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

export function entityOccurrences(db: Db, entityId: number): EntityOccurrence[] {
  return db
    .prepare(
      `SELECT c.id AS chapterId, c.title AS chapterTitle, c.position AS chapterPosition
       FROM mentions m JOIN chapters c ON c.id = m.chapter_id
       WHERE m.entity_id = ? ORDER BY c.position`
    )
    .all(entityId) as EntityOccurrence[]
}

export function entitiesInChapter(db: Db, chapterId: number): Entity[] {
  const rows = db
    .prepare(
      `SELECT e.* FROM mentions m JOIN entities e ON e.id = m.entity_id
       WHERE m.chapter_id = ? ORDER BY e.kind, e.name`
    )
    .all(chapterId)
  return rows.map(entityRowToEntity)
}
