import type { Db } from './connection'
import type { OutlineNote } from '../../shared/types'

interface OutlineRow {
  id: number
  book_id: number
  chapter_id: number | null
  position: number
  content: string
  updated_at: string
}

function rowToNote(row: OutlineRow): OutlineNote {
  return {
    id: row.id,
    bookId: row.book_id,
    chapterId: row.chapter_id,
    position: row.position,
    content: row.content,
    updatedAt: row.updated_at
  }
}

export function listOutline(db: Db, bookId: number): OutlineNote[] {
  const rows = db
    .prepare(
      'SELECT * FROM outline_notes WHERE book_id = ? ORDER BY chapter_id IS NOT NULL, chapter_id, position'
    )
    .all(bookId) as OutlineRow[]
  return rows.map(rowToNote)
}

export function createOutlineNote(db: Db, bookId: number, chapterId: number | null): OutlineNote {
  const result = db
    .prepare(
      `INSERT INTO outline_notes (book_id, chapter_id, position)
       VALUES (?, ?, (SELECT COALESCE(MAX(position), 0) + 1 FROM outline_notes
                      WHERE book_id = ? AND chapter_id IS ?))`
    )
    .run(bookId, chapterId, bookId, chapterId)
  const row = db
    .prepare('SELECT * FROM outline_notes WHERE id = ?')
    .get(Number(result.lastInsertRowid)) as OutlineRow
  return rowToNote(row)
}

export function updateOutlineNote(db: Db, id: number, content: string): void {
  db.prepare("UPDATE outline_notes SET content = ?, updated_at = datetime('now') WHERE id = ?").run(
    content,
    id
  )
}

export function reorderOutline(
  db: Db,
  bookId: number,
  chapterId: number | null,
  orderedIds: number[]
): void {
  const stmt = db.prepare(
    'UPDATE outline_notes SET position = ? WHERE id = ? AND book_id = ? AND chapter_id IS ?'
  )
  db.transaction(() => {
    orderedIds.forEach((id, i) => stmt.run(i + 1, id, bookId, chapterId))
  })()
}

export function deleteOutlineNote(db: Db, id: number): void {
  db.prepare('DELETE FROM outline_notes WHERE id = ?').run(id)
}
