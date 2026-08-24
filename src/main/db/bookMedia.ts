// SQL pur du magasin de médias du livre (table `book_media`, migration 7).
// Table et couche VOLONTAIREMENT séparées d'`illustrations` : une illustration
// est une planche insérable dans le texte et embarquée par les exports, un
// média est un livrable rangé À CÔTÉ du livre (couvertures, quatrième, promo)
// qui n'entre jamais dans le manuscrit. Aucun code ici ne doit toucher aux
// illustrations, et réciproquement.
import type { Db } from './connection'
import type { BookMedia, BookMediaRole } from '../../shared/types'

function rowToBookMedia(row: any): BookMedia {
  return {
    id: row.id,
    bookId: row.book_id,
    role: row.role,
    fileName: row.file_name,
    displayName: row.display_name,
    note: row.note,
    position: row.position,
    createdAt: row.created_at
  }
}

export function listBookMedia(db: Db, bookId: number): BookMedia[] {
  return db
    .prepare('SELECT * FROM book_media WHERE book_id = ? ORDER BY position, id')
    .all(bookId)
    .map(rowToBookMedia)
}

export function getBookMedia(db: Db, id: number): BookMedia {
  const row = db.prepare('SELECT * FROM book_media WHERE id = ?').get(id)
  if (!row) throw new Error(`Média introuvable: ${id}`)
  return rowToBookMedia(row)
}

// Premier média du rôle demandé, dans l'ordre d'affichage du magasin, ou null.
// C'est le point d'entrée de l'export EPUB pour retrouver sa couverture : rien
// n'interdit deux médias du même rôle (deux essais de couverture), l'ordre du
// magasin tranche — le premier gagne.
export function findBookMediaByRole(db: Db, bookId: number, role: BookMediaRole): BookMedia | null {
  const row = db
    .prepare(
      'SELECT * FROM book_media WHERE book_id = ? AND role = ? ORDER BY position, id LIMIT 1'
    )
    .get(bookId, role)
  return row ? rowToBookMedia(row) : null
}

export function createBookMedia(
  db: Db,
  bookId: number,
  role: BookMediaRole,
  fileName: string,
  displayName: string
): BookMedia {
  // Position = fin du magasin DU LIVRE (même calcul que createIllustration).
  const max = db
    .prepare('SELECT COALESCE(MAX(position), 0) AS m FROM book_media WHERE book_id = ?')
    .get(bookId) as { m: number }
  const result = db
    .prepare(
      'INSERT INTO book_media (book_id, role, file_name, display_name, position) VALUES (?, ?, ?, ?, ?)'
    )
    .run(bookId, role, fileName, displayName, max.m + 1)
  return getBookMedia(db, Number(result.lastInsertRowid))
}

// Patch partiel : seuls les champs PRÉSENTS sont écrits (un `note` absent ne
// doit pas effacer le mémo existant). Patch vide = no-op qui relit la ligne.
export function updateBookMedia(
  db: Db,
  id: number,
  patch: { role?: BookMediaRole; displayName?: string; note?: string }
): BookMedia {
  const sets: string[] = []
  const values: unknown[] = []
  if (patch.role !== undefined) {
    sets.push('role = ?')
    values.push(patch.role)
  }
  if (patch.displayName !== undefined) {
    sets.push('display_name = ?')
    values.push(patch.displayName)
  }
  if (patch.note !== undefined) {
    sets.push('note = ?')
    values.push(patch.note)
  }
  if (sets.length > 0) {
    db.prepare(`UPDATE book_media SET ${sets.join(', ')} WHERE id = ?`).run(...values, id)
  }
  return getBookMedia(db, id)
}

export function deleteBookMedia(db: Db, id: number): void {
  db.prepare('DELETE FROM book_media WHERE id = ?').run(id)
}
