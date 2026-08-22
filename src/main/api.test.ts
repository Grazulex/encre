import { describe, it, expect } from 'vitest'
import { openDb } from './db/connection'
import { createApi } from './api'

describe('createApi', () => {
  it('expose le cycle complet livre → chapitre → contenu', async () => {
    const api = createApi(openDb(':memory:'))
    const book = await api.books.create({ title: 'Via API' })
    const chapter = await api.chapters.create(book.id, 'Chapitre 1')
    await api.chapters.saveContent(chapter.id, '{"type":"doc","content":[]}', 'un deux trois')
    const metas = await api.chapters.listByBook(book.id)
    expect(metas[0].wordCount).toBe(3)
    const refreshed = await api.books.get(book.id)
    expect(refreshed.wordCount).toBe(3)
    expect(refreshed.chapterCount).toBe(1)
  })

  it('expose entités, plan, chronologie et résumé', async () => {
    const api = createApi(openDb(':memory:'))
    const book = await api.books.create({ title: 'Via API v2' })
    const mara = await api.entities.create({ bookId: book.id, kind: 'character', name: 'Mara' })
    const ch = await api.chapters.create(book.id, 'Ch. 1')
    await api.chapters.saveSummary(ch.id, 'Résumé.')
    expect((await api.chapters.get(ch.id)).summary).toBe('Résumé.')
    const note = await api.outline.create(book.id, ch.id)
    await api.outline.update(note.id, 'Plan du chapitre')
    const ev = await api.timeline.create(book.id, 'Incendie')
    await api.timeline.setLinks(ev.id, [ch.id], [mara.id])
    expect((await api.timeline.listByBook(book.id))[0].entityIds).toEqual([mara.id])
    expect(await api.entities.listByBook(book.id, 'character')).toHaveLength(1)
  })

  it('importe un dossier markdown en livre complet (transactionnel)', async () => {
    const { mkdtempSync, writeFileSync } = await import('fs')
    const { tmpdir } = await import('os')
    const { join } = await import('path')
    const dir = mkdtempSync(join(tmpdir(), 'encre-import-api-'))
    writeFileSync(join(dir, '01-un.md'), '# Un\n\nPremier chapitre.')
    writeFileSync(join(dir, '02-deux.md'), 'Deuxième **chapitre**.')
    const api = createApi(openDb(':memory:'))
    const book = await api.importer.importBook(dir, ['01-un.md', '02-deux.md'], 'Importé')
    expect(book.chapterCount).toBe(2)
    const metas = await api.chapters.listByBook(book.id)
    expect(metas.map((m) => m.title)).toEqual(['Un', 'deux'])
    expect(metas[0].wordCount).toBeGreaterThan(0)
  })

  it('exporte le livre en markdown, un fichier par chapitre', async () => {
    // exposer une fonction interne testable : exportMarkdownToFolder(db, bookId, folder)
    const { mkdtempSync, readdirSync, readFileSync } = await import('fs')
    const { tmpdir } = await import('os')
    const { join } = await import('path')
    const db = openDb(':memory:')
    const api = createApi(db)
    const book = await api.books.create({ title: 'Export' })
    const ch = await api.chapters.create(book.id, 'Chapitre un')
    await api.chapters.saveContent(ch.id, JSON.stringify({
      type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Bonjour.' }] }]
    }), 'Bonjour.')
    const dir = mkdtempSync(join(tmpdir(), 'encre-export-'))
    const { exportMarkdownToFolder } = await import('./exporter')
    exportMarkdownToFolder(db, book.id, dir)
    const files = readdirSync(dir)
    expect(files).toEqual(['01-chapitre-un.md'])
    expect(readFileSync(join(dir, files[0]), 'utf8')).toBe('# Chapitre un\n\nBonjour.\n')
  })
})
