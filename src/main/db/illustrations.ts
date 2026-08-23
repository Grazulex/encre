import type { Db } from './connection'
import type { Illustration } from '../../shared/types'

function rowToIllustration(row: any): Illustration {
  return {
    id: row.id,
    bookId: row.book_id,
    fileName: row.file_name,
    displayName: row.display_name,
    position: row.position,
    createdAt: row.created_at
  }
}

export function listIllustrations(db: Db, bookId: number): Illustration[] {
  return db
    .prepare('SELECT * FROM illustrations WHERE book_id = ? ORDER BY position, id')
    .all(bookId)
    .map(rowToIllustration)
}

export function getIllustration(db: Db, id: number): Illustration {
  const row = db.prepare('SELECT * FROM illustrations WHERE id = ?').get(id)
  if (!row) throw new Error(`Illustration introuvable: ${id}`)
  return rowToIllustration(row)
}

export function createIllustration(
  db: Db, bookId: number, fileName: string, displayName: string
): Illustration {
  const max = db
    .prepare('SELECT COALESCE(MAX(position), 0) AS m FROM illustrations WHERE book_id = ?')
    .get(bookId) as { m: number }
  const result = db
    .prepare('INSERT INTO illustrations (book_id, file_name, display_name, position) VALUES (?, ?, ?, ?)')
    .run(bookId, fileName, displayName, max.m + 1)
  return getIllustration(db, Number(result.lastInsertRowid))
}

export function renameIllustration(db: Db, id: number, displayName: string): Illustration {
  db.prepare('UPDATE illustrations SET display_name = ? WHERE id = ?').run(displayName, id)
  return getIllustration(db, id)
}

export function deleteIllustration(db: Db, id: number): void {
  db.prepare('DELETE FROM illustrations WHERE id = ?').run(id)
}
