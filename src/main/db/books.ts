import type { Db } from './connection'
import type { Book, BookCreate, BookPatch } from '../../shared/types'

const SELECT_BOOK = `
  SELECT b.*,
         s.name AS series_name,
         COALESCE(SUM(c.word_count), 0) AS agg_word_count,
         COUNT(c.id) AS agg_chapter_count
  FROM books b
  LEFT JOIN series s ON s.id = b.series_id
  LEFT JOIN chapters c ON c.book_id = b.id
`

function rowToBook(row: any): Book {
  return {
    id: row.id,
    title: row.title,
    author: row.author,
    genre: row.genre,
    language: row.language,
    synopsis: row.synopsis,
    status: row.status,
    coverPath: row.cover_path,
    wordGoal: row.word_goal,
    wordCount: row.agg_word_count,
    chapterCount: row.agg_chapter_count,
    seriesId: row.series_id,
    seriesName: row.series_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export function listBooks(db: Db): Book[] {
  return db
    .prepare(`${SELECT_BOOK} GROUP BY b.id ORDER BY b.updated_at DESC`)
    .all()
    .map(rowToBook)
}

export function getBook(db: Db, id: number): Book {
  const row = db.prepare(`${SELECT_BOOK} WHERE b.id = ? GROUP BY b.id`).get(id)
  if (!row) throw new Error(`Livre introuvable: ${id}`)
  return rowToBook(row)
}

export function createBook(db: Db, input: BookCreate): Book {
  const result = db
    .prepare(
      `INSERT INTO books (title, author, genre, language, synopsis, word_goal)
       VALUES (@title, @author, @genre, @language, @synopsis, @wordGoal)`
    )
    .run({
      title: input.title,
      author: input.author ?? '',
      genre: input.genre ?? '',
      language: input.language ?? 'fr',
      synopsis: input.synopsis ?? '',
      wordGoal: input.wordGoal ?? null
    })
  return getBook(db, Number(result.lastInsertRowid))
}

const PATCH_COLUMNS: Record<string, string> = {
  title: 'title',
  author: 'author',
  genre: 'genre',
  language: 'language',
  synopsis: 'synopsis',
  status: 'status',
  coverPath: 'cover_path',
  wordGoal: 'word_goal',
  seriesId: 'series_id'
}

export function updateBook(db: Db, id: number, patch: BookPatch): Book {
  const entries = Object.entries(patch).filter(([k]) => k in PATCH_COLUMNS)
  if (entries.length > 0) {
    const sets = entries.map(([k]) => `${PATCH_COLUMNS[k]} = @${k}`).join(', ')
    db.prepare(
      `UPDATE books SET ${sets}, updated_at = datetime('now') WHERE id = @id`
    ).run({ ...Object.fromEntries(entries), id })
  }
  return getBook(db, id)
}

export function deleteBook(db: Db, id: number): void {
  db.prepare('DELETE FROM books WHERE id = ?').run(id)
}
