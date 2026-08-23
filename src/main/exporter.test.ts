import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { openDb } from './db/connection'
import { createApi } from './api'
import { exportMarkdownToFolder } from './exporter'

function docWithIllustration(fileName: string): string {
  return JSON.stringify({
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'Avant.' }] },
      { type: 'illustration', attrs: { fileName, displayName: 'La maison' } }
    ]
  })
}

describe('exportMarkdownToFolder + illustrations', () => {
  it('copie les fichiers référencés dans Illustrations/ et rend ![…]', async () => {
    const db = openDb(':memory:')
    const api = createApi(db)
    const book = await api.books.create({ title: 'MD' })
    const c1 = await api.chapters.create(book.id, 'Un')
    const mediaDir = mkdtempSync(join(tmpdir(), 'encre-exp-media-'))
    writeFileSync(join(mediaDir, 'ill-1-9-0.png'), 'png')
    await api.chapters.saveContent(c1.id, docWithIllustration('ill-1-9-0.png'), 'Avant.')

    const out = mkdtempSync(join(tmpdir(), 'encre-exp-out-'))
    exportMarkdownToFolder(db, book.id, out, mediaDir)
    const md = readFileSync(join(out, '01-un.md'), 'utf8')
    expect(md).toContain('![La maison](Illustrations/ill-1-9-0.png)')
    expect(existsSync(join(out, 'Illustrations', 'ill-1-9-0.png'))).toBe(true)
  })

  it('omet un nœud dont le fichier media est absent', async () => {
    const db = openDb(':memory:')
    const api = createApi(db)
    const book = await api.books.create({ title: 'MD' })
    const c1 = await api.chapters.create(book.id, 'Un')
    const mediaDir = mkdtempSync(join(tmpdir(), 'encre-exp-media-'))
    await api.chapters.saveContent(c1.id, docWithIllustration('ill-1-9-9.png'), 'Avant.')

    const out = mkdtempSync(join(tmpdir(), 'encre-exp-out-'))
    exportMarkdownToFolder(db, book.id, out, mediaDir)
    const md = readFileSync(join(out, '01-un.md'), 'utf8')
    expect(md).not.toContain('ill-1-9-9.png')
    expect(existsSync(join(out, 'Illustrations'))).toBe(false)
  })
})
