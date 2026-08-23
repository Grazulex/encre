import { createHash } from 'crypto'
import { readdirSync } from 'fs'
import type { Db } from '../db/connection'
import type { BackupDiff } from '../../shared/types'

export type { BackupDiff }

export interface ManifestChapter {
  id: number
  bookId: number
  title: string
  words: number
  hash: string
}

export interface Manifest {
  version: 1
  generatedAt: string
  counts: { books: number; chapters: number; entities: number; illustrations: number; media: number }
  /** Identités, pas compteurs — voir diffManifests. */
  books: number[]
  media: string[]
  chapters: ManifestChapter[]
}

const TITLES_SHOWN = 5

function count(db: Db, table: string): number {
  return (db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n
}

export function buildManifest(db: Db, mediaDir: string, now: Date): Manifest {
  const rows = db
    .prepare('SELECT id, book_id, title, word_count, content_json FROM chapters ORDER BY id')
    .all() as { id: number; book_id: number; title: string; word_count: number; content_json: string }[]

  const chapters: ManifestChapter[] = rows.map((r) => ({
    id: r.id,
    bookId: r.book_id,
    title: r.title,
    words: r.word_count,
    // Le hash rattrape la réécriture à nombre de mots constant, que `words`
    // seul laisserait passer — or c'est précisément du travail à ne pas perdre.
    hash: createHash('sha1').update(r.content_json).digest('hex')
  }))

  const books = (db.prepare('SELECT id FROM books ORDER BY id').all() as { id: number }[]).map((b) => b.id)

  // Trié : sans tri, l'ordre de readdir ferait bouger le manifeste d'une
  // sauvegarde à l'autre sans qu'aucune donnée n'ait changé.
  let media: string[] = []
  try {
    media = readdirSync(mediaDir).sort()
  } catch {
    media = []
  }

  return {
    version: 1,
    generatedAt: now.toISOString(),
    counts: {
      books: books.length,
      chapters: chapters.length,
      entities: count(db, 'entities'),
      illustrations: count(db, 'illustrations'),
      media: media.length
    },
    books,
    media,
    chapters
  }
}

export function diffManifests(prev: Manifest | null, next: Manifest): BackupDiff {
  const before = new Map((prev?.chapters ?? []).map((c) => [c.id, c]))
  const after = new Map(next.chapters.map((c) => [c.id, c]))

  let chaptersChanged = 0
  let chaptersAdded = 0
  let chaptersRemoved = 0
  let wordsDelta = 0
  const changedTitles: string[] = []

  for (const c of next.chapters) {
    const old = before.get(c.id)
    if (!old) {
      chaptersAdded++
      wordsDelta += c.words
      changedTitles.push(c.title)
    } else if (old.hash !== c.hash) {
      chaptersChanged++
      wordsDelta += c.words - old.words
      changedTitles.push(c.title)
    }
  }
  for (const old of before.values()) {
    if (!after.has(old.id)) {
      chaptersRemoved++
      wordsDelta -= old.words
      changedTitles.push(old.title)
    }
  }

  // Par identité et non par différence de compteurs : 2 suppressions + 3 ajouts
  // donneraient « 1 ajouté » avec des compteurs, alors qu'il y a bien trois
  // fichiers neufs à sauvegarder.
  const knownMedia = new Set(prev?.media ?? [])
  const knownBooks = new Set(prev?.books ?? [])

  return {
    chaptersChanged,
    chaptersAdded,
    chaptersRemoved,
    wordsDelta,
    mediaAdded: next.media.filter((f) => !knownMedia.has(f)).length,
    booksAdded: next.books.filter((b) => !knownBooks.has(b)).length,
    changedTitles: changedTitles.slice(0, TITLES_SHOWN)
  }
}
