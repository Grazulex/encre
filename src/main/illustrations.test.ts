import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, existsSync, readdirSync, unlinkSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { openDb } from './db/connection'
import { createBook } from './db/books'
import { createChapter, saveChapterContent } from './db/chapters'
import { listIllustrations } from './db/illustrations'
import { addIllustrationFiles, removeIllustration, illustrationUsage } from './illustrations'

function setup() {
  const db = openDb(':memory:')
  const book = createBook(db, { title: 'Tome 1' })
  const srcDir = mkdtempSync(join(tmpdir(), 'encre-ill-src-'))
  const mediaDir = mkdtempSync(join(tmpdir(), 'encre-ill-media-'))
  return { db, book, srcDir, mediaDir }
}

describe('addIllustrationFiles', () => {
  it('copie les fichiers dans media et crée les lignes dans l\'ordre', () => {
    const { db, book, srcDir, mediaDir } = setup()
    writeFileSync(join(srcDir, 'planche-1.png'), 'png-1')
    writeFileSync(join(srcDir, 'planche-2.jpg'), 'jpg-2')
    const added = addIllustrationFiles(
      db, book.id, [join(srcDir, 'planche-1.png'), join(srcDir, 'planche-2.jpg')], mediaDir
    )
    expect(added).toHaveLength(2)
    expect(added[0].displayName).toBe('planche-1.png')
    expect(added[0].fileName).toMatch(new RegExp(`^ill-${book.id}-\\d+-0\\.png$`))
    expect(added[1].fileName).toMatch(/\.jpg$/)
    for (const ill of added) expect(existsSync(join(mediaDir, ill.fileName))).toBe(true)
    expect(listIllustrations(db, book.id)).toHaveLength(2)
  })

  it('ignore un fichier illisible ou d\'extension refusée sans bloquer les autres', () => {
    const { db, book, srcDir, mediaDir } = setup()
    writeFileSync(join(srcDir, 'ok.webp'), 'webp')
    writeFileSync(join(srcDir, 'notes.txt'), 'txt')
    const added = addIllustrationFiles(
      db, book.id,
      [join(srcDir, 'absent.png'), join(srcDir, 'notes.txt'), join(srcDir, 'ok.webp')],
      mediaDir
    )
    expect(added).toHaveLength(1)
    expect(added[0].displayName).toBe('ok.webp')
    expect(readdirSync(mediaDir)).toHaveLength(1)
  })
})

describe('removeIllustration / illustrationUsage', () => {
  it('supprime ligne + fichier, tolère un fichier déjà absent', () => {
    const { db, book, srcDir, mediaDir } = setup()
    writeFileSync(join(srcDir, 'p.png'), 'png')
    const [ill] = addIllustrationFiles(db, book.id, [join(srcDir, 'p.png')], mediaDir)
    removeIllustration(db, ill.id, mediaDir)
    expect(listIllustrations(db, book.id)).toHaveLength(0)
    expect(existsSync(join(mediaDir, ill.fileName))).toBe(false)
    // orphelin : re-création d'une ligne dont le fichier n'existe pas
    const [ill2] = addIllustrationFiles(db, book.id, [join(srcDir, 'p.png')], mediaDir)
    unlinkSync(join(mediaDir, ill2.fileName))
    expect(() => removeIllustration(db, ill2.id, mediaDir)).not.toThrow()
  })

  it('compte les chapitres qui référencent le fichier', () => {
    const { db, book, srcDir, mediaDir } = setup()
    writeFileSync(join(srcDir, 'p.png'), 'png')
    const [ill] = addIllustrationFiles(db, book.id, [join(srcDir, 'p.png')], mediaDir)
    const c1 = createChapter(db, book.id, 'Un')
    const c2 = createChapter(db, book.id, 'Deux')
    const doc = JSON.stringify({
      type: 'doc',
      content: [{ type: 'illustration', attrs: { fileName: ill.fileName, displayName: 'p.png' } }]
    })
    saveChapterContent(db, c1.id, doc, '')
    saveChapterContent(db, c2.id, '{"type":"doc","content":[]}', '')
    expect(illustrationUsage(db, ill.id)).toBe(1)
  })
})
