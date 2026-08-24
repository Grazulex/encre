// Logique testable du magasin de médias du livre : tout ce qui touche disque +
// base vit ici, hors electron — api.ts n'ajoutera que le dialogue de sélection
// et le chemin userData (même découpage que illustrations.ts).
import { copyFileSync, mkdirSync, unlinkSync } from 'fs'
import { join, extname, basename } from 'path'
import type { Db } from './db/connection'
import type { BookMedia, BookMediaRole } from '../shared/types'
import { createBookMedia, getBookMedia, deleteBookMedia } from './db/bookMedia'

// Extensions acceptées pour un média. Le `.pdf` est la différence assumée avec
// les illustrations (qui, elles, sont rendues dans l'éditeur et embarquées dans
// l'EPUB, donc images seules) : une couverture brochée est fournie par
// l'imprimeur en PDF, et ce fichier doit pouvoir être rangé avec le livre.
export const BOOK_MEDIA_EXTENSIONS: ReadonlySet<string> = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.pdf'
])

export function addBookMediaFiles(
  db: Db,
  bookId: number,
  role: BookMediaRole,
  sourcePaths: string[],
  mediaDir: string
): BookMedia[] {
  mkdirSync(mediaDir, { recursive: true })
  // Horodatage unique par lot + index par fichier : deux ajouts successifs du
  // même fichier source produisent des noms différents (une URL identique ne
  // serait pas revalidée par le renderer).
  const stamp = Date.now()
  const added: BookMedia[] = []
  sourcePaths.forEach((src, i) => {
    const ext = extname(src).toLowerCase()
    if (!BOOK_MEDIA_EXTENSIONS.has(ext)) return
    // Préfixe `bm-` OBLIGATOIRE : médias et illustrations (`ill-`) cohabitent
    // dans le même dossier media/, le préfixe est ce qui empêche de confondre
    // les deux magasins au nettoyage comme à l'inspection.
    const fileName = `bm-${bookId}-${stamp}-${i}${ext}`
    try {
      copyFileSync(src, join(mediaDir, fileName))
    } catch {
      // Fichier source illisible/absent : on ignore CE fichier, les autres de
      // la sélection continuent.
      return
    }
    added.push(createBookMedia(db, bookId, role, fileName, basename(src)))
  })
  return added
}

export function removeBookMedia(db: Db, id: number, mediaDir: string): void {
  const media = getBookMedia(db, id)
  deleteBookMedia(db, id)
  try {
    unlinkSync(join(mediaDir, media.fileName))
  } catch {
    // Fichier déjà absent (supprimé hors de l'app) : la ligne est retirée quand
    // même — pas d'erreur pour un orphelin.
  }
}
