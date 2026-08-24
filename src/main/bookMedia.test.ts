import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, existsSync, readdirSync, unlinkSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { openDb } from './db/connection'
import { createBook } from './db/books'
import { listBookMedia, findBookMediaByRole } from './db/bookMedia'
import { addBookMediaFiles, removeBookMedia, BOOK_MEDIA_EXTENSIONS } from './bookMedia'

function setup() {
  const db = openDb(':memory:')
  const book = createBook(db, { title: 'Tome 1' })
  const srcDir = mkdtempSync(join(tmpdir(), 'encre-bm-src-'))
  const mediaDir = mkdtempSync(join(tmpdir(), 'encre-bm-media-'))
  return { db, book, srcDir, mediaDir }
}

describe('addBookMediaFiles', () => {
  it("copie sous un nom préfixé bm- et crée les lignes dans l'ordre", () => {
    const { db, book, srcDir, mediaDir } = setup()
    writeFileSync(join(srcDir, 'cover.png'), 'png')
    writeFileSync(join(srcDir, 'promo.jpg'), 'jpg')
    const added = addBookMediaFiles(
      db,
      book.id,
      'couverture-epub',
      [join(srcDir, 'cover.png'), join(srcDir, 'promo.jpg')],
      mediaDir
    )
    expect(added).toHaveLength(2)
    expect(added[0].displayName).toBe('cover.png')
    expect(added[0].role).toBe('couverture-epub')
    // préfixe bm- : distinct de celui des illustrations (ill-), les deux
    // familles cohabitent dans le même dossier media/
    expect(added[0].fileName).toMatch(new RegExp(`^bm-${book.id}-\\d+-0\\.png$`))
    expect(added[0].fileName.startsWith('ill-')).toBe(false)
    expect(added[1].fileName).toMatch(/\.jpg$/)
    for (const m of added) expect(existsSync(join(mediaDir, m.fileName))).toBe(true)
    expect(listBookMedia(db, book.id)).toHaveLength(2)
    expect(findBookMediaByRole(db, book.id, 'couverture-epub')?.id).toBe(added[0].id)
  })

  it('accepte un .pdf (couverture brochée) mais refuse un .gif', () => {
    const { db, book, srcDir, mediaDir } = setup()
    expect(BOOK_MEDIA_EXTENSIONS.has('.pdf')).toBe(true)
    expect(BOOK_MEDIA_EXTENSIONS.has('.gif')).toBe(false)
    writeFileSync(join(srcDir, 'broche.pdf'), 'pdf')
    writeFileSync(join(srcDir, 'anim.gif'), 'gif')
    const added = addBookMediaFiles(
      db,
      book.id,
      'couverture-broche',
      [join(srcDir, 'broche.pdf'), join(srcDir, 'anim.gif')],
      mediaDir
    )
    expect(added).toHaveLength(1)
    expect(added[0].displayName).toBe('broche.pdf')
    expect(added[0].fileName).toMatch(/\.pdf$/)
    expect(readdirSync(mediaDir)).toHaveLength(1)
  })

  it('continue après une source illisible sans bloquer le reste de la sélection', () => {
    const { db, book, srcDir, mediaDir } = setup()
    writeFileSync(join(srcDir, 'ok.webp'), 'webp')
    const added = addBookMediaFiles(
      db,
      book.id,
      'autre',
      [join(srcDir, 'absent.png'), join(srcDir, 'ok.webp')],
      mediaDir
    )
    expect(added).toHaveLength(1)
    expect(added[0].displayName).toBe('ok.webp')
    expect(readdirSync(mediaDir)).toHaveLength(1)
  })

  it('deux ajouts du même fichier source produisent deux noms différents', async () => {
    const { db, book, srcDir, mediaDir } = setup()
    writeFileSync(join(srcDir, 'cover.png'), 'png')
    const [a] = addBookMediaFiles(db, book.id, 'autre', [join(srcDir, 'cover.png')], mediaDir)
    await new Promise((r) => setTimeout(r, 2)) // l'horodatage du lot doit changer
    const [b] = addBookMediaFiles(db, book.id, 'autre', [join(srcDir, 'cover.png')], mediaDir)
    expect(b.fileName).not.toBe(a.fileName)
    expect(readdirSync(mediaDir)).toHaveLength(2)
    expect(listBookMedia(db, book.id).map((m) => m.position)).toEqual([1, 2])
  })
})

describe('removeBookMedia', () => {
  it('supprime ligne + fichier, tolère un fichier déjà absent', () => {
    const { db, book, srcDir, mediaDir } = setup()
    writeFileSync(join(srcDir, 'cover.png'), 'png')
    const [m] = addBookMediaFiles(
      db,
      book.id,
      'couverture-epub',
      [join(srcDir, 'cover.png')],
      mediaDir
    )
    removeBookMedia(db, m.id, mediaDir)
    expect(listBookMedia(db, book.id)).toHaveLength(0)
    expect(existsSync(join(mediaDir, m.fileName))).toBe(false)
    // orphelin : la ligne existe, le fichier a disparu hors de l'app
    const [m2] = addBookMediaFiles(db, book.id, 'autre', [join(srcDir, 'cover.png')], mediaDir)
    unlinkSync(join(mediaDir, m2.fileName))
    expect(() => removeBookMedia(db, m2.id, mediaDir)).not.toThrow()
    expect(listBookMedia(db, book.id)).toHaveLength(0)
  })
})
