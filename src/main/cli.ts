// Export en ligne de commande, sans fenêtre : le même buildPdf / buildEpub que
// l'interface, mais piloté par les arguments du processus. Le PDF a besoin de
// Chromium (fenêtre invisible + printToPDF), c'est pourquoi la commande vit dans
// le processus main d'Electron et non dans un script Node à part :
//
//   Encre --export --livre 37 --sortie /dossier            un livre
//   Encre --export --tous --sortie /dossier                 tous les livres qui ont des chapitres
//   … --pdf | --epub                                        un seul format (les deux par défaut)
//
// Les fichiers sortent sous le nom slug-du-titre.pdf / .epub, comme le
// dialogue « Enregistrer sous » de l'interface.
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { Db } from './db/connection'
import { getBook, listBooks } from './db/books'
import { listChapters } from './db/chapters'
import { slugify } from './exporter'
import { buildEpub } from './epub'
import { buildPdf } from './pdf'

export type Format = 'pdf' | 'epub'

export interface ExportArgs {
  livres: 'tous' | number[]
  formats: Format[]
  sortie: string
}

// null : pas de `--export`, l'app démarre normalement. Lève une Error avec un
// message lisible quand la commande est mal formée.
export function parseExportArgs(argv: string[]): ExportArgs | null {
  if (!argv.includes('--export')) return null
  const livres: number[] = []
  let tous = false
  let sortie: string | null = null
  const formats: Format[] = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--livre') {
      const n = Number(argv[++i])
      if (!Number.isInteger(n) || n <= 0)
        throw new Error(`--livre attend un identifiant entier, reçu « ${argv[i] ?? ''} »`)
      livres.push(n)
    } else if (a === '--tous') tous = true
    else if (a === '--sortie') {
      sortie = argv[++i] ?? ''
      if (sortie === '' || sortie.startsWith('--')) throw new Error('--sortie attend un dossier')
    } else if (a === '--pdf') formats.push('pdf')
    else if (a === '--epub') formats.push('epub')
  }
  if (tous && livres.length > 0) throw new Error('--tous et --livre sont exclusifs')
  if (!tous && livres.length === 0) throw new Error('indiquer --tous ou au moins un --livre N')
  if (sortie === null) throw new Error('--sortie DOSSIER est obligatoire')
  return {
    livres: tous ? 'tous' : livres,
    formats: formats.length ? formats : ['pdf', 'epub'],
    sortie
  }
}

// Un livre s'exporte s'il a au moins un chapitre après les Liminaires
// (position 1) : les tomes créés vides n'ont rien à produire.
export function livresExportables(db: Db): number[] {
  return listBooks(db)
    .filter((b) => listChapters(db, b.id).some((c) => c.position >= 2))
    .map((b) => b.id)
}

export interface Builders {
  pdf: (db: Db, bookId: number, chapterIds: number[], mediaDir?: string) => Promise<Buffer>
  epub: (db: Db, bookId: number, chapterIds: number[], mediaDir?: string) => Promise<Buffer>
}

const BUILDERS: Builders = { pdf: buildPdf, epub: buildEpub }

// Écrit slug.pdf et/ou slug.epub dans `sortie` (créé au besoin) et renvoie les
// chemins écrits. Les constructeurs sont injectables pour tester sans Electron.
export async function exporterLivre(
  db: Db,
  bookId: number,
  mediaDir: string,
  sortie: string,
  formats: Format[],
  builders: Builders = BUILDERS
): Promise<string[]> {
  const book = getBook(db, bookId)
  mkdirSync(sortie, { recursive: true })
  const ecrits: string[] = []
  for (const format of formats) {
    const buffer = await builders[format](db, bookId, [], mediaDir)
    const chemin = join(sortie, `${slugify(book.title)}.${format}`)
    writeFileSync(chemin, buffer)
    ecrits.push(chemin)
  }
  return ecrits
}

export interface ExportResultat {
  ecrits: string[]
  erreurs: { bookId: number; message: string }[]
}

// Enchaîne les livres sans s'arrêter au premier échec : chaque erreur est
// rapportée avec son livre, le code de sortie est à la charge de l'appelant.
export async function lancerExport(
  db: Db,
  mediaDir: string,
  args: ExportArgs,
  log: (ligne: string) => void = () => {},
  builders: Builders = BUILDERS
): Promise<ExportResultat> {
  const ids = args.livres === 'tous' ? livresExportables(db) : args.livres
  const resultat: ExportResultat = { ecrits: [], erreurs: [] }
  for (const id of ids) {
    try {
      const ecrits = await exporterLivre(db, id, mediaDir, args.sortie, args.formats, builders)
      resultat.ecrits.push(...ecrits)
      log(`[${id}] ${getBook(db, id).title} → ${ecrits.map((c) => c.split('/').pop()).join(', ')}`)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      resultat.erreurs.push({ bookId: id, message })
      log(`[${id}] ÉCHEC : ${message}`)
    }
  }
  return resultat
}
