import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, chmodSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { openDb, type Db } from '../db/connection'
import { createBook } from '../db/books'
import { createChapter } from '../db/chapters'
import { buildManifest, diffManifests, type Manifest } from './manifest'

let db: Db
let mediaDir: string
const NOW = new Date('2026-08-23T20:00:00.000Z')

beforeEach(() => {
  db = openDb(':memory:')
  mediaDir = mkdtempSync(join(tmpdir(), 'encre-manifest-media-'))
})

// Fabrique un manifeste minimal, pour tester diffManifests sans base.
function manifest(over: Partial<Manifest> = {}): Manifest {
  return {
    version: 1,
    generatedAt: NOW.toISOString(),
    counts: { books: 0, chapters: 0, entities: 0, illustrations: 0, bookMedia: 0, media: 0 },
    books: [],
    media: [],
    chapters: [],
    ...over
  }
}

describe('buildManifest', () => {
  it('photographie chapitres, comptes, livres et noms de médias', () => {
    const book = createBook(db, { title: 'Livre' })
    const ch = createChapter(db, book.id, 'Ch. 1')
    db.prepare('UPDATE chapters SET content_json = ?, word_count = ? WHERE id = ?').run(
      '{"doc":1}',
      42,
      ch.id
    )
    writeFileSync(join(mediaDir, 'b.png'), 'x')
    writeFileSync(join(mediaDir, 'a.png'), 'x')

    const m = buildManifest(db, mediaDir, NOW)

    expect(m.version).toBe(1)
    expect(m.generatedAt).toBe('2026-08-23T20:00:00.000Z')
    expect(m.counts).toMatchObject({ books: 1, chapters: 1, media: 2 })
    expect(m.books).toEqual([book.id])
    expect(m.media).toEqual(['a.png', 'b.png']) // trié, pour un diff git stable
    expect(m.chapters).toEqual([
      { id: ch.id, bookId: book.id, title: 'Ch. 1', words: 42, hash: expect.any(String) }
    ])
  })

  it('tolère un dossier media absent', () => {
    const m = buildManifest(db, join(mediaDir, 'nexistepas'), NOW)
    expect(m.media).toEqual([])
    expect(m.counts.media).toBe(0)
  })

  it('relève une erreur de permission (non-ENOENT)', () => {
    // Crée un dossier avec des permissions restrictives pour tester le rejet
    // des erreurs autres que ENOENT. Sur macOS, chmod 000 fonctionne ;
    // sur certains systèmes (par ex. root), ce test peut être instable.
    const restrictedDir = join(mediaDir, 'restricted')
    mkdirSync(restrictedDir)
    chmodSync(restrictedDir, 0o000)

    expect(() => buildManifest(db, restrictedDir, NOW)).toThrow()

    // Restaure les permissions pour que le nettoyage en beforeEach réussisse
    chmodSync(restrictedDir, 0o755)
  })
})

describe('diffManifests', () => {
  it("ne signale rien quand rien n'a changé", () => {
    const m = manifest({
      chapters: [{ id: 1, bookId: 1, title: 'A', words: 10, hash: 'h1' }]
    })
    const d = diffManifests(m, m)
    expect(d).toMatchObject({
      chaptersChanged: 0,
      chaptersAdded: 0,
      chaptersRemoved: 0,
      wordsDelta: 0
    })
  })

  it('attrape une réécriture à nombre de mots constant (le cas du hash)', () => {
    const prev = manifest({
      chapters: [{ id: 1, bookId: 1, title: 'A', words: 10, hash: 'avant' }]
    })
    const next = manifest({
      chapters: [{ id: 1, bookId: 1, title: 'A', words: 10, hash: 'apres' }]
    })
    const d = diffManifests(prev, next)
    expect(d.chaptersChanged).toBe(1)
    expect(d.wordsDelta).toBe(0)
    expect(d.changedTitles).toEqual(['A'])
  })

  it('compte les chapitres ajoutés et le delta de mots', () => {
    const prev = manifest({ chapters: [{ id: 1, bookId: 1, title: 'A', words: 10, hash: 'h1' }] })
    const next = manifest({
      chapters: [
        { id: 1, bookId: 1, title: 'A', words: 25, hash: 'h1b' },
        { id: 2, bookId: 1, title: 'B', words: 5, hash: 'h2' }
      ]
    })
    const d = diffManifests(prev, next)
    expect(d).toMatchObject({ chaptersChanged: 1, chaptersAdded: 1, wordsDelta: 20 })
  })

  it('compte les chapitres supprimés et retire leurs mots', () => {
    const prev = manifest({
      chapters: [
        { id: 1, bookId: 1, title: 'A', words: 10, hash: 'h1' },
        { id: 2, bookId: 1, title: 'B', words: 7, hash: 'h2' }
      ]
    })
    const next = manifest({ chapters: [{ id: 1, bookId: 1, title: 'A', words: 10, hash: 'h1' }] })
    const d = diffManifests(prev, next)
    expect(d).toMatchObject({ chaptersRemoved: 1, wordsDelta: -7 })
    expect(d.changedTitles).toEqual(['B'])
  })

  it('première sauvegarde (prev null) : tout est ajouté', () => {
    const next = manifest({
      counts: { books: 1, chapters: 1, entities: 0, illustrations: 0, bookMedia: 0, media: 2 },
      books: [1],
      media: ['a.png', 'b.png'],
      chapters: [{ id: 1, bookId: 1, title: 'A', words: 10, hash: 'h1' }]
    })
    const d = diffManifests(null, next)
    expect(d).toMatchObject({ chaptersAdded: 1, wordsDelta: 10, mediaAdded: 2, booksAdded: 1 })
  })

  it('compte les médias par identité, pas par différence de compteurs', () => {
    // 2 supprimés, 3 ajoutés : un calcul par compteurs dirait « 1 ajouté ».
    const prev = manifest({ media: ['a.png', 'b.png', 'c.png'] })
    const next = manifest({ media: ['a.png', 'd.png', 'e.png', 'f.png'] })
    expect(diffManifests(prev, next).mediaAdded).toBe(3)
  })

  it('tronque changedTitles à 5', () => {
    const chapters = Array.from({ length: 8 }, (_, i) => ({
      id: i + 1,
      bookId: 1,
      title: `Ch ${i + 1}`,
      words: 1,
      hash: 'h'
    }))
    const d = diffManifests(null, manifest({ chapters }))
    expect(d.chaptersAdded).toBe(8)
    expect(d.changedTitles).toHaveLength(5)
  })
})
