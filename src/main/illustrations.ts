// Logique testable du domaine illustrations (Task illustrations) : tout ce
// qui touche disque + base vit ici, hors electron — api.ts n'ajoute que le
// dialogue de sélection et le chemin userData (même découpage
// qu'importChapterFromFile vs importer.importChapter).
import { copyFileSync, mkdirSync, unlinkSync } from 'fs'
import { join, extname, basename } from 'path'
import type { Db } from './db/connection'
import type { Illustration } from '../shared/types'
import { createIllustration, getIllustration, deleteIllustration } from './db/illustrations'

// Mêmes extensions que pickCover/pickImage (api.ts) et que la table des
// media-types EPUB — la seule famille d'images que l'app sait afficher et
// exporter.
const ALLOWED_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp'])

export function addIllustrationFiles(
  db: Db,
  bookId: number,
  sourcePaths: string[],
  mediaDir: string
): Illustration[] {
  mkdirSync(mediaDir, { recursive: true })
  // Horodatage unique par lot + index par fichier : deux ajouts successifs du
  // même fichier source produisent des noms différents (même raison que le
  // nommage des couvertures — une URL identique ne serait pas revalidée par
  // le renderer).
  const stamp = Date.now()
  const added: Illustration[] = []
  sourcePaths.forEach((src, i) => {
    const ext = extname(src).toLowerCase()
    if (!ALLOWED_EXTENSIONS.has(ext)) return
    const fileName = `ill-${bookId}-${stamp}-${i}${ext}`
    try {
      copyFileSync(src, join(mediaDir, fileName))
    } catch {
      // Fichier source illisible/absent : on ignore CE fichier, les autres
      // de la sélection continuent (contrat d'erreur de la spec §6).
      return
    }
    added.push(createIllustration(db, bookId, fileName, basename(src)))
  })
  return added
}

export function removeIllustration(db: Db, id: number, mediaDir: string): void {
  const ill = getIllustration(db, id)
  deleteIllustration(db, id)
  try {
    unlinkSync(join(mediaDir, ill.fileName))
  } catch {
    // Fichier déjà absent (supprimé hors de l'app) : la ligne est retirée
    // quand même — pas d'erreur pour un orphelin (spec §6).
  }
}

export function illustrationUsage(db: Db, id: number): number {
  const ill = getIllustration(db, id)
  // LIKE suffit : les noms générés (ill-{bookId}-{ts}-{n}.{ext}) ne
  // contiennent ni % ni _ ni quote — pas d'échappement nécessaire.
  const row = db
    .prepare('SELECT COUNT(*) AS n FROM chapters WHERE book_id = ? AND content_json LIKE ?')
    .get(ill.bookId, `%${ill.fileName}%`) as { n: number }
  return row.n
}
