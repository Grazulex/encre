import type { Db } from './connection'
import type {
  Chapter,
  ChapterMeta,
  ChapterStatus,
  Entity,
  EntityOccurrence,
  SearchHit
} from '../../shared/types'
import { extractMentionIds } from '../../shared/mentions'
import { foldWithMap } from '../../shared/autolink'
import { entityRowToEntity, type EntityRow } from './entities'

export function countWords(text: string): number {
  const trimmed = text.trim()
  return trimmed ? trimmed.split(/\s+/).length : 0
}

interface ChapterMetaRow {
  id: number
  book_id: number
  position: number
  title: string
  status: ChapterStatus
  word_count: number
  word_goal: number | null
  updated_at: string
}

interface ChapterRow extends ChapterMetaRow {
  content_json: string
  content_text: string
  summary: string
}

function rowToMeta(row: ChapterMetaRow): ChapterMeta {
  return {
    id: row.id,
    bookId: row.book_id,
    position: row.position,
    title: row.title,
    status: row.status,
    wordCount: row.word_count,
    wordGoal: row.word_goal ?? null,
    updatedAt: row.updated_at
  }
}

export function listChapters(db: Db, bookId: number): ChapterMeta[] {
  const rows = db
    .prepare(
      `SELECT id, book_id, position, title, status, word_count, word_goal, updated_at
       FROM chapters WHERE book_id = ? ORDER BY position`
    )
    .all(bookId) as ChapterMetaRow[]
  return rows.map(rowToMeta)
}

export interface ChapterSummary {
  id: number
  position: number
  title: string
  summary: string
}

// Vue légère (Task 6, plan 3c — fix round 1) : buildChronoPrompt (main/ai/
// chronoContext.ts) a besoin du résumé manuel de CHAQUE chapitre d'un livre,
// mais ni du contenu (content_json/content_text, potentiellement volumineux)
// ni des autres métadonnées de ChapterMeta. Appeler getChapter en boucle
// (SELECT * par chapitre) aurait chargé ce contenu inutilement pour chaque
// chapitre du livre — cette requête dédiée ne sélectionne que les 4 colonnes
// réellement utiles, en un seul aller-retour SQLite pour tout le livre.
export function listChapterSummaries(db: Db, bookId: number): ChapterSummary[] {
  return db
    .prepare(
      `SELECT id, position, title, summary
       FROM chapters WHERE book_id = ? ORDER BY position`
    )
    .all(bookId) as ChapterSummary[]
}

export function getChapter(db: Db, id: number): Chapter {
  const row = db.prepare('SELECT * FROM chapters WHERE id = ?').get(id) as ChapterRow | undefined
  if (!row) throw new Error(`Chapitre introuvable: ${id}`)
  return {
    ...rowToMeta(row),
    contentJson: row.content_json,
    contentText: row.content_text,
    summary: row.summary
  }
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
    id: meta.id,
    book_id: meta.bookId,
    position: meta.position,
    title: meta.title,
    status: meta.status,
    word_count: meta.wordCount,
    word_goal: meta.wordGoal,
    updated_at: meta.updatedAt
  })
}

export function saveChapterContent(
  db: Db,
  id: number,
  contentJson: string,
  contentText: string
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
  db.prepare("UPDATE chapters SET title = ?, updated_at = datetime('now') WHERE id = ?").run(
    title,
    id
  )
}

export function saveChapterSummary(db: Db, id: number, summary: string): void {
  db.prepare("UPDATE chapters SET summary = ?, updated_at = datetime('now') WHERE id = ?").run(
    summary,
    id
  )
}

export function setChapterStatus(db: Db, id: number, status: ChapterStatus): void {
  db.prepare("UPDATE chapters SET status = ?, updated_at = datetime('now') WHERE id = ?").run(
    status,
    id
  )
}

export function setChapterGoal(db: Db, id: number, wordGoal: number | null): void {
  db.prepare("UPDATE chapters SET word_goal = ?, updated_at = datetime('now') WHERE id = ?").run(
    wordGoal,
    id
  )
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
    .all(chapterId) as EntityRow[]
  return rows.map(entityRowToEntity)
}

// Recherche plein texte dans le livre : insensible à la casse ET aux accents
// (même repliement que l'autolink, via foldWithMap — la map reconvertit la
// position de la première occurrence repliée en position d'origine, dont on
// découpe le snippet sans jamais altérer le texte source).
interface ChapterSearchRow {
  id: number
  position: number
  title: string
  content_text: string
}
export function searchInBook(db: Db, bookId: number, query: string): SearchHit[] {
  const needle = query.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim()
  if (!needle) return []
  const rows = db
    .prepare(
      `SELECT id, position, title, content_text
       FROM chapters WHERE book_id = ? ORDER BY position`
    )
    .all(bookId) as ChapterSearchRow[]
  const RADIUS = 70
  const hits: SearchHit[] = []
  for (const row of rows) {
    const text = row.content_text ?? ''
    const { folded: foldedText, map } = foldWithMap(text)
    const idx = foldedText.indexOf(needle)
    if (idx === -1) continue
    const start = map[idx]
    const end = map[idx + needle.length - 1] + 1
    const beforeStart = Math.max(0, start - RADIUS)
    const afterEnd = Math.min(text.length, end + RADIUS)
    hits.push({
      chapterId: row.id,
      chapterTitle: row.title,
      chapterPosition: row.position,
      start,
      snippet: {
        before: (beforeStart > 0 ? '…' : '') + text.slice(beforeStart, start),
        match: text.slice(start, end),
        after: text.slice(end, afterEnd) + (afterEnd < text.length ? '…' : '')
      }
    })
  }
  return hits
}
